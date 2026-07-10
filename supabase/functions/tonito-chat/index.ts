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

function buildSystemPrompt(profile: any, module: any | null, history: any[]): string {
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
    ? `\n\nEl estudiante está estudiando AHORA MISMO el módulo "${module.title}" de ${module.category} (dificultad ${module.difficulty_level}/10). Si pregunta algo del tema, ayúdalo. Si quiere desviarse, redirígelo amablemente.`
    : '\n\nEl estudiante está navegando libremente. Puedes conversar de cualquier tema apropiado.';

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

CONTEXTO DEL ESTUDIANTE:
- Nombre: ${name}
- Nivel actual: ${level}
- Racha: ${streak} días seguidos${streak >= 7 ? ' (¡impresionante!)' : ''}
${moduleContext}${historyContext}

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
10. NO uses formato markdown (** __ ## etc). Texto plano natural.`;
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

    // Cargar perfil + módulo (si aplica) en paralelo
    const [{ data: profile }, moduleResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      moduleId
        ? supabase.from('content_modules').select('*').eq('id', moduleId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const module = moduleResult.data;
    const systemPrompt = buildSystemPrompt(profile, module, history);

    // Guardar mensaje del usuario en historial
    await supabase.from('tonito_conversations').insert({
      user_id: user.id,
      module_id: moduleId || null,
      role: 'user',
      message,
      interaction_type: 'chat',
    });

    // ── Llamada a Gemini con streaming ──
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n---\n\nEl estudiante dice: "${message}"\n\nResponde como Toñito:` }],
          },
        ],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 500,
          responseMimeType: 'text/plain',
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
      }),
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      throw new Error(`Gemini API error ${geminiResponse.status}: ${errText}`);
    }

    // ── Stream parser: convertir SSE de Gemini a chunks de texto plano ──
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let fullResponse = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader = geminiResponse.body!.getReader();
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
                const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  fullResponse += text;
                  // Enviar chunk al cliente como SSE simple
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`)
                  );
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
