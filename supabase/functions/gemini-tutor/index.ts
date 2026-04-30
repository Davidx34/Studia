// supabase/functions/gemini-tutor/index.ts
// Deploy: supabase functions deploy gemini-tutor
// Set secret: supabase secrets set GEMINI_API_KEY=tu_key_aqui

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  moduleId: string;
  interactionType: 'generate_question' | 'evaluate_answer' | 'explain_concept' | 'chat';
  userMessage?: string;
  questionContext?: {
    question: string;
    options: string[];
    correctIndex: number;
    userAnswerIndex: number;
  };
}

interface GeminiQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

// ── Hash sencillo para cache ──
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 32);
}

// ── Constructor de prompts ──
function buildSystemPrompt(
  module: any,
  profile: any,
  interactionType: string
): string {
  const level = profile?.current_level || 1;
  const interests = profile?.gemini_preferences?.interests || [];
  const tonePersonality =
    level < 5
      ? 'entusiasta y paciente, usas analogías simples, celebras cada pequeño logro'
      : level < 15
      ? 'motivador pero desafiante, empujas al estudiante a dar lo mejor'
      : 'respetuoso y profundo, asumes conocimiento previo';

  const baseRules = `
Eres Toñito, el tutor mascota de Stud.ia. Personalidad: ${tonePersonality}.
Te interesa ${interests[0] || 'aprender de todo'}.

REGLAS ESTRICTAS:
- Responde SIEMPRE en español neutro, claro y conciso.
- Máximo 2-3 oraciones cortas por respuesta (excepto para preguntas).
- Usa máximo 2 emojis por mensaje, solo cuando sumen calidez.
- Eres un compañero amigo, no un profesor rígido. Nunca uses lenguaje robótico.
- Adapta el tono al nivel del estudiante (nivel actual: ${level}).

CONTEXTO DEL MÓDULO:
- Título: ${module.title}
- Categoría: ${module.category}
- Dificultad: ${module.difficulty_level}/10
- Descripción: ${module.description || 'Sin descripción adicional'}
${module.gemini_prompt_template ? `\nINSTRUCCIÓN ESPECÍFICA DEL PROFESOR:\n${module.gemini_prompt_template}` : ''}
`.trim();

  if (interactionType === 'generate_question') {
    return `${baseRules}

TAREA: Genera UNA pregunta de opción múltiple sobre el tema del módulo.

PROCESO INTERNO OBLIGATORIO (hazlo mentalmente antes de escribir el JSON):
1. Decide el escenario creativo de la pregunta (personaje, situación, contexto cotidiano).
2. Calcula o razona la respuesta correcta. Verifica que el resultado sea matemáticamente/lógicamente correcto.
3. Crea las 4 opciones: la correcta + 3 distractores plausibles pero incorrectos.
4. Escribe la explicación verificando que mencione EXACTAMENTE la opción correcta y el razonamiento que la justifica. La explicación NO debe contradecir la respuesta.

DEBES responder ÚNICAMENTE con un objeto JSON válido, sin markdown, sin backticks, sin texto adicional:
{
  "question": "El texto de la pregunta",
  "options": ["opción A", "opción B", "opción C", "opción D"],
  "correctIndex": 0,
  "explanation": "Explicación coherente de por qué options[correctIndex] es la respuesta correcta"
}

REGLAS ESTRICTAS:
- correctIndex debe apuntar a la opción que es REALMENTE la respuesta correcta. Verifica esto dos veces.
- La explanation debe ser 100% coherente con options[correctIndex]. Nunca menciones el valor de otra opción como si fuera el resultado correcto.
- Si la pregunta es matemática, incluye el cálculo paso a paso en la explicación (ej: "3 + 5 = 8, por eso la respuesta es 8").
- Usa contextos creativos y variados: deportes, cocina, animales, videojuegos, viajes, música, naturaleza, tecnología. Evita repetir el mismo escenario.
- Las 4 opciones deben ser números o respuestas plausibles, no obviamente incorrectas.
- Nivel de dificultad: ${module.difficulty_level}/10. Ajusta la complejidad del cálculo o razonamiento.
- NO uses fórmulas LaTeX. Escribe todo en texto plano.
- Longitud de la explicación: máximo 3 oraciones claras y directas.`;
  }

  if (interactionType === 'evaluate_answer') {
    return `${baseRules}

TAREA: Da feedback breve y específico al estudiante sobre su respuesta. Sé cálido pero honesto.
NO uses JSON, responde en texto plano natural en máximo 2 oraciones.`;
  }

  if (interactionType === 'explain_concept') {
    return `${baseRules}

TAREA: Explica el concepto que el estudiante pregunta de forma simple y memorable.
Usa una analogía si ayuda. Máximo 3 oraciones. No uses JSON.`;
  }

  // chat
  return `${baseRules}

TAREA: Conversa naturalmente con el estudiante. Responde su pregunta o comentario.
Si pregunta algo del módulo, ayuda. Si quiere charlar, sé amigable.
Máximo 3 oraciones. No uses JSON.`;
}

// ── Llamada a Groq API (OpenAI-compatible, modelos open source) ──
async function callGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY no configurada');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'user',
          content: `${systemPrompt}\n\n---\n\nINPUT: ${userMessage}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return text.trim();
}

// ── Parsing robusto de JSON de Gemini ──
function parseGeminiQuestion(text: string): GeminiQuestion {
  // Quitar markdown code fences si los hay
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  // Intentar extraer el primer objeto JSON
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No se encontró JSON válido en la respuesta de Gemini');

  const parsed = JSON.parse(jsonMatch[0]);

  // Validar estructura
  if (
    typeof parsed.question !== 'string' ||
    !Array.isArray(parsed.options) ||
    parsed.options.length !== 4 ||
    typeof parsed.correctIndex !== 'number' ||
    parsed.correctIndex < 0 ||
    parsed.correctIndex > 3 ||
    typeof parsed.explanation !== 'string'
  ) {
    throw new Error('Estructura de pregunta inválida');
  }

  return parsed as GeminiQuestion;
}

// ── Handler principal ──
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Cliente de Supabase con el JWT del usuario que llama
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid user' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: RequestBody = await req.json();
    const { moduleId, interactionType, userMessage, questionContext } = body;

    // Cargar contexto: módulo + perfil
    const [{ data: module }, { data: profile }] = await Promise.all([
      supabase.from('content_modules').select('*').eq('id', moduleId).single(),
      supabase.from('profiles').select('*').eq('id', user.id).single(),
    ]);

    if (!module) {
      return new Response(JSON.stringify({ error: 'Module not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── CACHE para preguntas generadas ──
    if (interactionType === 'generate_question') {
      const cacheKey = `${module.id}:${module.title}:${module.difficulty_level}`;
      const contentHash = await sha256(cacheKey);

      // Buscar pregunta cacheada que no haya expirado
      const { data: cached } = await supabase
        .from('generated_questions')
        .select('*')
        .eq('module_id', moduleId)
        .eq('content_hash', contentHash)
        .gt('expires_at', new Date().toISOString())
        .order('times_served', { ascending: true })
        .limit(5);

      // Solo servir caché cuando haya 15+ preguntas distintas acumuladas
      if (cached && cached.length >= 15) {
        const random = cached[Math.floor(Math.random() * cached.length)];
        await supabase
          .from('generated_questions')
          .update({ times_served: random.times_served + 1 })
          .eq('id', random.id);

        return new Response(
          JSON.stringify({
            type: 'question',
            cached: true,
            data: {
              id: random.id,
              question: random.question_text,
              options: random.options,
              correctIndex: random.correct_index,
              explanation: random.explanation,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Generar pregunta nueva con variación aleatoria para evitar repeticiones
      const systemPrompt = buildSystemPrompt(module, profile, 'generate_question');
      const variantes = [
        'Genera una pregunta nueva y diferente a las anteriores.',
        'Crea una pregunta desde un ángulo distinto al habitual.',
        'Formula una pregunta con un ejemplo cotidiano diferente.',
        'Genera una pregunta que desafíe un error conceptual común.',
        'Crea una pregunta con números o contexto diferente a los usuales.',
      ];
      const userPrompt = variantes[Math.floor(Math.random() * variantes.length)];
      const geminiText = await callGemini(systemPrompt, userPrompt);
      const question = parseGeminiQuestion(geminiText);

      // Guardar en cache
      const { data: saved } = await supabase
        .from('generated_questions')
        .insert({
          module_id: moduleId,
          content_hash: contentHash,
          question_text: question.question,
          question_type: 'multiple_choice',
          options: question.options,
          correct_index: question.correctIndex,
          explanation: question.explanation,
          difficulty: module.difficulty_level,
          times_served: 1,
        })
        .select()
        .single();

      return new Response(
        JSON.stringify({
          type: 'question',
          cached: false,
          data: {
            id: saved?.id,
            ...question,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Evaluación de respuesta ──
    if (interactionType === 'evaluate_answer' && questionContext) {
      const isCorrect = questionContext.userAnswerIndex === questionContext.correctIndex;
      const userChoice = questionContext.options[questionContext.userAnswerIndex];
      const correctChoice = questionContext.options[questionContext.correctIndex];

      const systemPrompt = buildSystemPrompt(module, profile, 'evaluate_answer');
      const userPrompt = isCorrect
        ? `El estudiante respondió correctamente "${userChoice}" a la pregunta: "${questionContext.question}". Felicítalo brevemente y refuerza el concepto.`
        : `El estudiante respondió "${userChoice}" pero la respuesta correcta era "${correctChoice}" a la pregunta: "${questionContext.question}". Anímalo y explica brevemente por qué la correcta es esa.`;

      const feedback = await callGemini(systemPrompt, userPrompt);

      return new Response(
        JSON.stringify({
          type: 'feedback',
          isCorrect,
          message: feedback,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Chat libre ──
    if (interactionType === 'chat' || interactionType === 'explain_concept') {
      const systemPrompt = buildSystemPrompt(module, profile, interactionType);
      const reply = await callGemini(systemPrompt, userMessage || '¿Puedes ayudarme?');

      // Guardar en historial
      await supabase.from('tonito_conversations').insert([
        {
          user_id: user.id,
          module_id: moduleId,
          role: 'user',
          message: userMessage || '',
          interaction_type: 'chat',
        },
        {
          user_id: user.id,
          module_id: moduleId,
          role: 'tonito',
          message: reply,
          interaction_type: 'chat',
        },
      ]);

      return new Response(
        JSON.stringify({ type: 'chat', message: reply }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'Unknown interaction type' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal error',
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
