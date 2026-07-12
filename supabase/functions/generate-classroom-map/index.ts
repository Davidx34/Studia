// Edge Function: generate-classroom-map
// Fase 11.D · Stud.ia · Clases con IA
//
// Recibe { classroom_id }. Lee chunks + topics_detected + classroom info,
// llama a Gemini "Map Designer" con structured output JSON pidiendo entre
// 5-12 nodos con prerequisites por índice + posiciones x:50-950 y:50-1500.
// INSERT en content_modules con auto_generated=true. Resuelve prerequisites
// (índice -> UUID) en un segundo pass.
//
// Variables de entorno:
//   - GEMINI_API_KEY                requerida
//   - SUPABASE_URL                  auto-set
//   - SUPABASE_SERVICE_ROLE_KEY     auto-set
//
// Deploy:
//   supabase functions deploy generate-classroom-map

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_CHAT_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  classroom_id: string;
}

interface DesignerModule {
  title: string;
  description: string;
  topic_keywords: string[];
  difficulty_level: number; // 1-10
  estimated_time_minutes: number;
  prerequisites_indices: number[];
  map_position_x: number; // 50-950
  map_position_y: number; // 50-1500
  category: string;
}

interface DesignerResponse {
  modules: DesignerModule[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) {
    return jsonResponse({ ok: false, error: 'GEMINI_API_KEY no configurada' }, 500);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (!body.classroom_id) {
    return jsonResponse({ ok: false, error: 'classroom_id requerido' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Lookup classroom
  const { data: classroom, error: cErr } = await admin
    .from('classrooms')
    .select('id, name, description, subject_area, grade_level, teacher_id')
    .eq('id', body.classroom_id)
    .single();
  if (cErr || !classroom) {
    return jsonResponse({ ok: false, error: 'Classroom no encontrada' }, 404);
  }

  // 2. Lookup materials completados + chunks (sample)
  const { data: materials } = await admin
    .from('teaching_materials')
    .select('id, filename, topics_detected, estimated_difficulty, extracted_text_preview')
    .eq('classroom_id', classroom.id)
    .eq('processing_status', 'completed');

  if (!materials || materials.length === 0) {
    return jsonResponse(
      { ok: false, error: 'La clase no tiene materiales procesados todavía' },
      400
    );
  }

  // Aggregar topics + samples de texto para alimentar al Map Designer
  const allTopics = new Set<string>();
  const samples: string[] = [];
  for (const m of materials) {
    for (const t of m.topics_detected ?? []) allTopics.add(t);
    if (m.extracted_text_preview) samples.push(`[${m.filename}]\n${m.extracted_text_preview}`);
  }

  // 3. Llamar a Map Designer
  const designerResult = await callMapDesigner(GEMINI_API_KEY, {
    classroomName: classroom.name,
    subjectArea: classroom.subject_area ?? 'general',
    gradeLevel: classroom.grade_level ?? 'sin grado',
    description: classroom.description ?? '',
    topics: Array.from(allTopics),
    samples: samples.join('\n\n').slice(0, 20000),
  });

  if (!designerResult.modules || designerResult.modules.length < 3) {
    return jsonResponse(
      { ok: false, error: 'Map Designer devolvió menos de 3 módulos. Revisar material.' },
      500
    );
  }

  // 4. Validar y clamp valores
  const sourceMaterialIds = materials.map((m) => m.id);
  const cleanModules = designerResult.modules.map((m) => clampModule(m));

  // 5. Primera pass: INSERT módulos sin prerequisites
  const inserts = cleanModules.map((m, idx) => ({
    classroom_id: classroom.id,
    teacher_id: classroom.teacher_id,
    title: m.title.slice(0, 200),
    description: m.description.slice(0, 1000),
    category: m.category.slice(0, 50),
    difficulty_level: m.difficulty_level,
    content_type: 'interactive' as const,
    base_xp_reward: 10 * m.difficulty_level,
    estimated_time_minutes: m.estimated_time_minutes,
    prerequisites: [], // se llena en segunda pass
    order_index: idx,
    map_position_x: m.map_position_x,
    map_position_y: m.map_position_y,
    is_active: true,
    auto_generated: true,
    topic_keywords: m.topic_keywords,
    source_material_ids: sourceMaterialIds,
  }));

  const { data: inserted, error: insErr } = await admin
    .from('content_modules')
    .insert(inserts)
    .select('id, order_index');

  if (insErr || !inserted) {
    return jsonResponse({ ok: false, error: `Error insertando módulos: ${insErr?.message}` }, 500);
  }

  // 6. Segunda pass: resolver prerequisites (índice -> UUID)
  const idxToUuid = new Map<number, string>();
  for (const r of inserted as Array<{ id: string; order_index: number }>) {
    idxToUuid.set(r.order_index, r.id);
  }

  for (let i = 0; i < cleanModules.length; i++) {
    const prereqIndices = cleanModules[i].prerequisites_indices.filter(
      (p) => p >= 0 && p < cleanModules.length && p !== i
    );
    if (prereqIndices.length === 0) continue;
    const prereqUuids = prereqIndices
      .map((p) => idxToUuid.get(p))
      .filter((u): u is string => Boolean(u));
    const targetId = idxToUuid.get(i);
    if (!targetId || prereqUuids.length === 0) continue;

    await admin
      .from('content_modules')
      .update({ prerequisites: prereqUuids })
      .eq('id', targetId);
  }

  return jsonResponse({
    ok: true,
    classroom_id: classroom.id,
    modules_created: cleanModules.length,
  });
});

// ============================================================
// Helpers
// ============================================================

// Debe coincidir EXACTAMENTE con el CHECK constraint content_modules_category_check
// en la DB (no incluye 'general' - insertar esa categoria rompe el INSERT con un 500).
const VALID_CATEGORIES = ['math', 'science', 'language', 'history', 'logic'];

function clampModule(m: DesignerModule): DesignerModule {
  return {
    title: m.title || 'Módulo sin título',
    description: m.description || '',
    topic_keywords: Array.isArray(m.topic_keywords) ? m.topic_keywords.slice(0, 8) : [],
    difficulty_level: clamp(m.difficulty_level ?? 5, 1, 10),
    estimated_time_minutes: clamp(m.estimated_time_minutes ?? 10, 3, 60),
    prerequisites_indices: Array.isArray(m.prerequisites_indices) ? m.prerequisites_indices : [],
    map_position_x: clamp(m.map_position_x ?? 500, 50, 950),
    map_position_y: clamp(m.map_position_y ?? 200, 50, 1500),
    category: VALID_CATEGORIES.includes(m.category) ? m.category : 'history',
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

async function callMapDesigner(
  apiKey: string,
  input: {
    classroomName: string;
    subjectArea: string;
    gradeLevel: string;
    description: string;
    topics: string[];
    samples: string;
  }
): Promise<DesignerResponse> {
  const url = `${GEMINI_BASE_URL}/models/${GEMINI_CHAT_MODEL}:generateContent?key=${apiKey}`;

  const prompt = `Eres un diseñador de currículum experto. Tu tarea: diseñar un MAPA DE APRENDIZAJE
para esta clase, dividido en 5-12 módulos secuenciales con dificultad progresiva.

CLASE:
- Nombre: ${input.classroomName}
- Materia: ${input.subjectArea}
- Grado: ${input.gradeLevel}
- Descripción: ${input.description}

TEMAS DETECTADOS EN EL MATERIAL:
${input.topics.length > 0 ? input.topics.map((t) => `- ${t}`).join('\n') : '(ninguno)'}

EXTRACTOS DEL MATERIAL:
"""
${input.samples}
"""

REGLAS:
- 5 a 12 módulos
- Dificultad creciente (el primer módulo debe ser difficulty_level 1-3, el último 7-10)
- El primer módulo NO debe tener prerequisites_indices (debe estar vacío [])
- Cada módulo posterior puede listar índices (0-based) de módulos que deben completarse antes
- map_position_x: entre 50 y 950 (ancho del canvas)
- map_position_y: entre 50 y 1500 (largo del canvas, aumenta hacia abajo)
- Los módulos más fáciles arriba (y bajo), los difíciles abajo (y alto)
- estimated_time_minutes: entre 3 y 60
- topic_keywords: 2-5 palabras clave por módulo
- Títulos en español neutro, máximo 80 caracteres
- Descripciones cortas (1-2 oraciones)
- category: usa EXACTAMENTE uno de estos valores (nunca otro): "math", "science", "language", "history", "logic"`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          modules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                topic_keywords: { type: 'array', items: { type: 'string' } },
                difficulty_level: { type: 'integer', minimum: 1, maximum: 10 },
                estimated_time_minutes: { type: 'integer', minimum: 3, maximum: 60 },
                prerequisites_indices: { type: 'array', items: { type: 'integer' } },
                map_position_x: { type: 'integer', minimum: 50, maximum: 950 },
                map_position_y: { type: 'integer', minimum: 50, maximum: 1500 },
                category: { type: 'string', enum: VALID_CATEGORIES },
              },
              required: [
                'title',
                'description',
                'topic_keywords',
                'difficulty_level',
                'estimated_time_minutes',
                'prerequisites_indices',
                'map_position_x',
                'map_position_y',
                'category',
              ],
            },
          },
        },
        required: ['modules'],
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini Map Designer falló: ${res.status} ${t}`);
  }
  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Map Designer respuesta vacía');
  return JSON.parse(raw) as DesignerResponse;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
