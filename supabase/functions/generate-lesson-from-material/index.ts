// Edge Function: generate-lesson-from-material
// Fase 11.D · Stud.ia · Clases con IA
//
// Recibe { module_id, student_id, question_count? }.
// Two-stage:
//   Stage 1 - Outliner: Gemini genera outline JSON con N entradas mezclando
//             tipos (3 MC, 1 V/F, 1 Fill por defecto), variando ángulos
//             cognitivos. Cache check en lesson_generations (TTL 7d).
//   Stage 2 - Writer: por cada entrada del outline:
//             - embedding del search_query
//             - match_material_chunks(embedding, classroom_id, 5) -> top 5 chunks
//             - prompt según question_type con responseMimeType + responseSchema
//             - INSERT en generated_questions
//
// Devuelve array de questions (con type) al cliente.
//
// Variables de entorno: igual que generate-classroom-map.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_CHAT_MODEL = 'gemini-1.5-flash';
const GEMINI_EMBED_MODEL = 'text-embedding-004';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type QuestionType = 'multiple_choice' | 'true_false' | 'fill_blank';

interface RequestBody {
  module_id: string;
  student_id: string;
  question_count?: number;
}

interface OutlineEntry {
  question_type: QuestionType;
  cognitive_angle: string;
  search_query: string;
  difficulty_within_lesson: number; // 1-5
}

interface OutlineResponse {
  outline: OutlineEntry[];
}

interface MultipleChoiceQ {
  question: string;
  options: [string, string, string, string];
  correct_index: number;
  explanation: string;
  source_quote: string;
}

interface TrueFalseQ {
  statement: string;
  is_true: boolean;
  explanation: string;
  source_quote: string;
}

interface FillBlankQ {
  sentence_with_blank: string;
  correct_answer: string;
  alternatives_accepted: string[];
  explanation: string;
  source_quote: string;
}

type ConcreteQ =
  | { question_type: 'multiple_choice'; data: MultipleChoiceQ }
  | { question_type: 'true_false'; data: TrueFalseQ }
  | { question_type: 'fill_blank'; data: FillBlankQ };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) return jsonResponse({ ok: false, error: 'GEMINI_API_KEY missing' }, 500);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (!body.module_id || !body.student_id) {
    return jsonResponse({ ok: false, error: 'module_id y student_id requeridos' }, 400);
  }
  const questionCount = clamp(body.question_count ?? 5, 3, 8);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Lookup module + classroom
  const { data: module, error: mErr } = await admin
    .from('content_modules')
    .select(
      'id, title, description, classroom_id, difficulty_level, source_material_ids, topic_keywords, auto_generated'
    )
    .eq('id', body.module_id)
    .single();
  if (mErr || !module || !module.classroom_id) {
    return jsonResponse({ ok: false, error: 'Módulo no encontrado o sin classroom' }, 404);
  }
  if (!module.auto_generated) {
    return jsonResponse(
      { ok: false, error: 'Este módulo no es auto-generado; usar gemini-tutor' },
      400
    );
  }

  // 2. Calcular materials_version_hash (id+version de los materiales fuente)
  const sourceIds: string[] = (module.source_material_ids as string[]) ?? [];
  let materialsHash = 'no-materials';
  if (sourceIds.length > 0) {
    const { data: mats } = await admin
      .from('teaching_materials')
      .select('id, version, processing_status')
      .in('id', sourceIds)
      .eq('processing_status', 'completed');
    materialsHash = await sha256(
      (mats ?? [])
        .map((m: any) => `${m.id}:${m.version}`)
        .sort()
        .join('|')
    );
  }

  // 3. Cache check en lesson_generations
  let outline: OutlineEntry[];
  const { data: cached } = await admin
    .from('lesson_generations')
    .select('outline, materials_version_hash, expires_at')
    .eq('module_id', module.id)
    .eq('difficulty_level', module.difficulty_level)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached && cached.materials_version_hash === materialsHash) {
    outline = (cached.outline as { entries: OutlineEntry[] }).entries;
  } else {
    // Stage 1 - Outliner
    const outlineResp = await callOutliner(GEMINI_API_KEY, {
      moduleTitle: module.title,
      moduleDescription: module.description ?? '',
      topics: (module.topic_keywords as string[]) ?? [],
      difficulty: module.difficulty_level,
      questionCount,
    });
    outline = outlineResp.outline.slice(0, questionCount);

    // Persistir cache (UPSERT manual: borrar viejos + insert nuevo)
    await admin
      .from('lesson_generations')
      .delete()
      .eq('module_id', module.id)
      .eq('difficulty_level', module.difficulty_level);

    await admin.from('lesson_generations').insert({
      module_id: module.id,
      classroom_id: module.classroom_id,
      difficulty_level: module.difficulty_level,
      outline: { entries: outline } as any,
      materials_version_hash: materialsHash,
    });
  }

  // 4. Stage 2 - Writer (por cada entrada del outline)
  const generatedQuestions: ConcreteQ[] = [];

  for (const entry of outline) {
    try {
      // 4a. Embedding del search_query
      const embedding = await embedSingle(GEMINI_API_KEY, entry.search_query);

      // 4b. RAG retrieval
      const { data: chunks } = (await admin.rpc('match_material_chunks', {
        query_embedding: embedding,
        classroom_id_filter: module.classroom_id,
        match_count: 5,
      } as any)) as { data: Array<{ content: string; filename: string }> | null };

      const contextChunks = (chunks ?? [])
        .map((c, i) => `[${i + 1}] (${c.filename})\n${c.content}`)
        .join('\n\n');

      if (!contextChunks) continue; // sin contexto, saltar

      // 4c. Generar pregunta del tipo correspondiente
      const q = await writeQuestion(GEMINI_API_KEY, {
        questionType: entry.question_type,
        cognitiveAngle: entry.cognitive_angle,
        moduleTitle: module.title,
        contextChunks,
      });
      if (!q) continue;

      // NOTA: NO cacheamos preguntas individuales en generated_questions porque
      // la tabla esta hardcodeada al shape MC (question_text + options + correct_index
      // NOT NULL). El cache util esta en lesson_generations (outline cached),
      // que ahorra el LLM call mas caro. Generar preguntas con gemini-1.5-flash
      // cuesta ~$0.002 por leccion, asumible.

      generatedQuestions.push({ question_type: entry.question_type, data: q } as ConcreteQ);
    } catch (err) {
      console.warn('Question generation failed:', (err as Error).message);
    }
  }

  if (generatedQuestions.length === 0) {
    return jsonResponse(
      { ok: false, error: 'No se pudo generar ninguna pregunta. Revisa los chunks.' },
      500
    );
  }

  return jsonResponse({
    ok: true,
    module_id: module.id,
    questions: generatedQuestions,
  });
});

// ============================================================
// Stage 1: Outliner
// ============================================================

async function callOutliner(
  apiKey: string,
  input: {
    moduleTitle: string;
    moduleDescription: string;
    topics: string[];
    difficulty: number;
    questionCount: number;
  }
): Promise<OutlineResponse> {
  const url = `${GEMINI_BASE_URL}/models/${GEMINI_CHAT_MODEL}:generateContent?key=${apiKey}`;
  const prompt = `Diseña el outline de una lección sobre "${input.moduleTitle}".
Descripción: ${input.moduleDescription}
Temas clave: ${input.topics.join(', ')}
Dificultad del módulo: ${input.difficulty}/10

Necesitas ${input.questionCount} preguntas. Distribuye los tipos así:
- ~60% multiple_choice
- ~20% true_false
- ~20% fill_blank

Para cada pregunta:
- question_type: tipo
- cognitive_angle: qué se evalúa (definición, aplicación, comparación, causa-efecto, ejemplo, contraste, etc.)
- search_query: query semántica para buscar el chunk relevante (string en español)
- difficulty_within_lesson: 1-5 (creciente)`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          outline: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question_type: {
                  type: 'string',
                  enum: ['multiple_choice', 'true_false', 'fill_blank'],
                },
                cognitive_angle: { type: 'string' },
                search_query: { type: 'string' },
                difficulty_within_lesson: { type: 'integer', minimum: 1, maximum: 5 },
              },
              required: [
                'question_type',
                'cognitive_angle',
                'search_query',
                'difficulty_within_lesson',
              ],
            },
          },
        },
        required: ['outline'],
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Outliner failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Outliner: respuesta vacía');
  return JSON.parse(raw) as OutlineResponse;
}

// ============================================================
// Stage 2: Writer
// ============================================================

async function writeQuestion(
  apiKey: string,
  input: {
    questionType: QuestionType;
    cognitiveAngle: string;
    moduleTitle: string;
    contextChunks: string;
  }
): Promise<MultipleChoiceQ | TrueFalseQ | FillBlankQ | null> {
  const url = `${GEMINI_BASE_URL}/models/${GEMINI_CHAT_MODEL}:generateContent?key=${apiKey}`;

  const baseRules = `Estás generando UNA pregunta para una lección sobre "${input.moduleTitle}".
Ángulo cognitivo: ${input.cognitiveAngle}.
Genera la pregunta basándote ESTRICTAMENTE en los siguientes extractos del material del profesor.
Cita textual obligatoria en source_quote (max 200 chars, copiada del material).

CONTEXTO:
"""
${input.contextChunks}
"""

REGLAS:
- Texto en español neutro
- No inventes datos que no estén en el contexto
- source_quote debe ser texto literal (o casi literal) de un chunk`;

  let schema: Record<string, unknown>;
  if (input.questionType === 'multiple_choice') {
    schema = {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 4,
          maxItems: 4,
        },
        correct_index: { type: 'integer', minimum: 0, maximum: 3 },
        explanation: { type: 'string' },
        source_quote: { type: 'string' },
      },
      required: ['question', 'options', 'correct_index', 'explanation', 'source_quote'],
    };
  } else if (input.questionType === 'true_false') {
    schema = {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        is_true: { type: 'boolean' },
        explanation: { type: 'string' },
        source_quote: { type: 'string' },
      },
      required: ['statement', 'is_true', 'explanation', 'source_quote'],
    };
  } else {
    // fill_blank
    schema = {
      type: 'object',
      properties: {
        sentence_with_blank: { type: 'string' },
        correct_answer: { type: 'string' },
        alternatives_accepted: { type: 'array', items: { type: 'string' } },
        explanation: { type: 'string' },
        source_quote: { type: 'string' },
      },
      required: [
        'sentence_with_blank',
        'correct_answer',
        'alternatives_accepted',
        'explanation',
        'source_quote',
      ],
    };
  }

  const extraRule =
    input.questionType === 'fill_blank'
      ? `\nUsa "____" (4 underscores) en lugar del blanco. La respuesta debe ser 1-3 palabras.`
      : input.questionType === 'multiple_choice'
        ? `\noptions debe ser un array de exactamente 4 strings. correct_index entre 0 y 3.`
        : `\nstatement debe ser una afirmación clara verdadera o falsa según el contexto.`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: baseRules + extraRule }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn(`Writer failed: ${res.status}`);
    return null;
  }
  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ============================================================
// Embedding singular
// ============================================================

async function embedSingle(apiKey: string, text: string): Promise<number[]> {
  const url = `${GEMINI_BASE_URL}/models/${GEMINI_EMBED_MODEL}:embedContent?key=${apiKey}`;
  const body = {
    model: `models/${GEMINI_EMBED_MODEL}`,
    content: { parts: [{ text }] },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`embedSingle failed: ${res.status}`);
  const json = await res.json();
  return json.embedding?.values ?? [];
}

// ============================================================
// Util
// ============================================================

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
