// supabase/functions/tonito-chat/index.ts
// Edge Function dedicada al chat conversacional con Toñito (streaming)
// Deploy: supabase functions deploy tonito-chat

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ChatRequest {
  message: string;
  moduleId?: string; // opcional: si está en una lección
  history?: { role: 'user' | 'tonito'; text: string }[]; // últimos mensajes para contexto
}

function buildSystemPrompt(
  profile: any,
  module: any | null,
  history: any[],
  perf: { overallAccuracy: number | null; weakConcepts: string[]; strongConcepts: string[]; hasData: boolean },
  moduleScore: number | null,
  timeOfDay: 'mañana' | 'tarde' | 'noche'
): string {
  const level = profile?.current_level || 1;
  const name = profile?.full_name?.split(' ')[0] || profile?.username || 'amigo';
  const interests = profile?.gemini_preferences?.interests || [];
  const streak = profile?.streak_days || 0;

  const tonePersonality =
    level < 5
      ? 'entusiasta y paciente, usa analogías simples y celebra cada avance'
      : level < 15
      ? 'motivador pero desafiante, empuja al estudiante a dar lo mejor'
      : 'respetuoso y profundo, asume conocimiento previo';

  const moduleContext = module
    ? `\n\nEl estudiante está estudiando AHORA MISMO el módulo "${module.title}" de ${module.category} (dificultad ${module.difficulty_level}/10)${
        moduleScore !== null ? `, va ${moduleScore}% en este módulo` : ''
      }. Si pregunta algo del tema, ayúdalo. Si quiere desviarse, redirígelo amablemente.`
    : '\n\nEl estudiante está navegando libremente. Puedes conversar de cualquier tema apropiado.';

  // Mejora 2: desempeño real del estudiante (agregado de question_attempts),
  // para que Toñito hable de fortalezas/debilidades CONCRETAS, no genéricas.
  const performanceContext = perf.hasData
    ? `\n\nDESEMPEÑO GENERAL DE ${name.toUpperCase()}:
- Precisión general: ${perf.overallAccuracy}%
${perf.strongConcepts.length > 0 ? `- Domina bien: ${perf.strongConcepts.join(', ')}` : ''}
${perf.weakConcepts.length > 0 ? `- Necesita refuerzo en: ${perf.weakConcepts.join(', ')}` : ''}
Si pregunta cómo le va o pide ayuda con temas difíciles, usa estos datos concretos (nombra el concepto exacto, no hables en general).`
    : '';

  const historyContext =
    history && history.length > 0
      ? `\n\nÚLTIMOS MENSAJES DE LA CONVERSACIÓN:\n${history
          .slice(-6)
          .map((h: any) => `${h.role === 'user' ? name : 'Tú (Toñito)'}: ${h.text}`)
          .join('\n')}`
      : '';

  return `Eres Toñito, una mascota virtual amigable que actúa como tutor en Stud.ia, una plataforma educativa gamificada para niños y adolescentes.

PERSONALIDAD:
- Eres ${tonePersonality}.
- Eres un compañero amigo, NUNCA un profesor rígido.
- Te encanta ${interests[0] || 'aprender de todo'}.
- Hablas con calidez y energía juvenil.
- Es de ${timeOfDay} para el estudiante: si es mañana usa energía alta, si es tarde motívalo a seguir, si es noche sugiere no quemarse y descansar si ya llevan rato.

CONTEXTO DEL ESTUDIANTE:
- Nombre: ${name}
- Nivel actual: ${level}
- Racha: ${streak} días seguidos${streak >= 7 ? ' (¡impresionante!)' : ''}
${moduleContext}${performanceContext}${historyContext}

REGLAS ESTRICTAS:
1. Responde SIEMPRE en español neutro, claro y conciso.
2. Máximo 3 oraciones por respuesta. Sé directo.
3. Usa máximo 2 emojis por mensaje, solo cuando sumen calidez.
4. NUNCA uses lenguaje robótico tipo "Como modelo de lenguaje..." o "Soy una IA...".
5. Si te preguntan quién eres, responde: "¡Soy Toñito, tu compañero de Stud.ia! 🎉".
6. Si te preguntan algo inapropiado para niños, redirige amablemente al estudio.
7. Si te piden ayuda con tarea/concepto, da una pista o explicación corta — no la respuesta completa de un examen.
8. Llama al estudiante por su nombre (${name}) cuando sea natural.
9. Si te preguntan cosas que no sabes, admítelo con humildad y sugiere buscarlo juntos.
10. NO uses formato markdown (** __ ## etc). Texto plano natural.
11. Responde SIEMPRE con oraciones completas — termina cada oración con un punto. Nunca cortes a media frase; si no te alcanza el espacio, sé más breve pero completo.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization' }), {
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
    } = await supabase.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid user' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: ChatRequest = await req.json();
    const { message, moduleId, history = [] } = body;

    if (!message || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Empty message' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cargar perfil + módulo (si aplica) + intentos de preguntas, en paralelo.
    const [{ data: profile }, moduleResult, attemptsResult, progressResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      moduleId
        ? supabase.from('content_modules').select('*').eq('id', moduleId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('question_attempts')
        .select('concept_tag, was_correct')
        .eq('student_id', user.id)
        .not('concept_tag', 'is', null)
        .limit(500),
      moduleId
        ? supabase
            .from('student_progress')
            .select('score')
            .eq('student_id', user.id)
            .eq('module_id', moduleId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const module = moduleResult.data;
    const moduleScore: number | null = progressResult.data?.score ?? null;

    // Mejora 2: agregar question_attempts por concept_tag para saber
    // fortalezas/debilidades REALES del estudiante (mismo criterio que el
    // panel de brecha de conocimiento del profesor: <70% debil, >=80% fuerte).
    const perf = (() => {
      const rows = attemptsResult.data || [];
      if (rows.length === 0) return { overallAccuracy: null, weakConcepts: [], strongConcepts: [], hasData: false };
      const byTag = new Map<string, { correct: number; total: number }>();
      let totalCorrect = 0;
      for (const r of rows as any[]) {
        const e = byTag.get(r.concept_tag) ?? { correct: 0, total: 0 };
        e.total += 1;
        if (r.was_correct) { e.correct += 1; totalCorrect += 1; }
        byTag.set(r.concept_tag, e);
      }
      const withAccuracy = [...byTag.entries()].map(([tag, e]) => ({ tag, accuracy: Math.round((e.correct / e.total) * 100) }));
      const weakConcepts = withAccuracy.filter((c) => c.accuracy < 70).sort((a, b) => a.accuracy - b.accuracy).slice(0, 3).map((c) => c.tag);
      const strongConcepts = withAccuracy.filter((c) => c.accuracy >= 80).sort((a, b) => b.accuracy - a.accuracy).slice(0, 3).map((c) => c.tag);
      return {
        overallAccuracy: Math.round((totalCorrect / rows.length) * 100),
        weakConcepts,
        strongConcepts,
        hasData: true,
      };
    })();

    // Hora local aproximada del estudiante (LatAm, offset fijo UTC-5) — solo
    // para ajustar el tono, no necesita ser exacta.
    const localHour = (new Date().getUTCHours() - 5 + 24) % 24;
    const timeOfDay = localHour < 12 ? 'mañana' : localHour < 19 ? 'tarde' : 'noche';

    const systemPrompt = buildSystemPrompt(profile, module, history, perf, moduleScore, timeOfDay);

    // Guardar mensaje del usuario en historial
    await supabase.from('tonito_conversations').insert({
      user_id: user.id,
      module_id: moduleId || null,
      role: 'user',
      message,
      interaction_type: 'chat',
    });

    // ── Llamada a Groq con streaming ──
    // Cambio de Gemini a Groq para el chat conversacional de Toñito: no
    // consume el mismo presupuesto de tokens que la generacion de preguntas
    // (que sigue en Gemini/Cohere), tiene tier gratis real (sin tarjeta,
    // sin programa de datos compartidos) y responde muy rapido gracias a
    // su hardware de inferencia especializado (LPU). La API de Groq es
    // compatible con el formato de OpenAI (chat completions + streaming SSE).
    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) throw new Error('GROQ_API_KEY no configurada');

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        stream: true,
        temperature: 0.8,
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      throw new Error(`Groq API error ${groqResponse.status}: ${errText}`);
    }

    // ── Stream parser: SSE estilo OpenAI (choices[0].delta.content) ──
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let fullResponse = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader = groqResponse.body!.getReader();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // dejar línea incompleta

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (!data || data === '[DONE]') continue;

              try {
                const json = JSON.parse(data);
                const text = json?.choices?.[0]?.delta?.content;
                if (text) {
                  fullResponse += text;
                  // Enviar chunk al cliente como SSE simple
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`)
                  );
                }
                const finishReason = json?.choices?.[0]?.finish_reason;
                if (finishReason && finishReason !== 'stop') {
                  console.warn('[TONITO_RESPONSE_TRUNCATED]', { finishReason, textLength: fullResponse.length });
                }
              } catch {
                // ignorar líneas mal formadas
              }
            }
          }

          // Enviar evento final
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();

          // Guardar respuesta completa en historial (fire & forget)
          if (fullResponse) {
            supabase
              .from('tonito_conversations')
              .insert({
                user_id: user.id,
                module_id: moduleId || null,
                role: 'tonito',
                message: fullResponse,
                interaction_type: 'chat',
              })
              .then(() => {});
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
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
