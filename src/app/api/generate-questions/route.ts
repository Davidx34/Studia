import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { isValidQuestion } from '@/lib/lesson/validateQuestion';
import {
  shuffle,
  getRagContext,
  normalizeGeneratedQuestion,
  callCohere,
  RAG_CONTEXT_CHAR_LIMIT,
  ANTI_HALLUCINATION_BLOCK,
} from '@/lib/questions/cohereGeneration';
import {
  resolveConfig,
  resolveMinigames,
  allowedTypeSet,
  enforceAllowedTypes,
  buildGenerationPrompt,
  remediationPreamble,
  type AiConfigRow,
  type ResolvedConfig,
} from '@/lib/questions/generationConfig';
import { getOrCreateModuleConcepts, conceptTaxonomyPromptBlock } from '@/lib/questions/conceptTaxonomy';
import { withGenerationLock } from '@/lib/questions/generationLock';
import { servableQuestions, drawQuestions } from '@/lib/questions/poolServing';

// Una generacion con Cohere tarda de 37 a 67 s (medido el 2026-09-19 con un prompt de
// ~28.000 caracteres; la de 67 s incluia un reintento interno), y hasta ~110 s si
// reintenta 3 veces. El proyecto tiene Fluid compute (default y maximo de 300 s en
// Hobby). Declararlo explicito evita que alguien lo baje sin darse cuenta: con 60 se
// cortarian justo las generaciones lentas, dejando al estudiante con un fallo y el
// bloqueo tomado hasta que caduque.
export const maxDuration = 300;

const MIN_CACHE_SIZE = 5; // debajo de esto, todavia se sirve del cache si alcanza
const SERVE_COUNT = 5; // preguntas que ve el estudiante por leccion
const GENERATE_COUNT = 10; // preguntas generadas por llamada a Cohere (puebla el cache mas rapido)

// Genera 4 preguntas cortas (multiple_choice/true_false, sin minijuegos) enfocadas
// SOLO en los concept_tag debiles que paso el cliente. Se usa para el repaso dirigido
// (Sesion E.1): nunca se cachea ni se guarda en lesson_questions (es efimero, se
// descarta despues de usarse una vez), asi que siempre llama a Cohere directo.
async function generateRemediationQuestions(
  supabase: any,
  moduleId: string,
  moduleTitle: string,
  weakConcepts: string[],
  config: ResolvedConfig
): Promise<any[]> {
  if (!process.env.COHERE_API_KEY) return [];

  const context = await getRagContext(supabase, moduleId);

  const prompt = `Eres un profesor de apoyo haciendo un repaso corto y alentador con un estudiante.

TEMA DEL MODULO: ${moduleTitle}
${remediationPreamble(config)}CONTENIDO DEL MATERIAL:
${(context || '').substring(0, RAG_CONTEXT_CHAR_LIMIT)}

El estudiante tuvo dificultad especificamente con estos conceptos: ${weakConcepts.join(', ')}.

Genera EXACTAMENTE 4 preguntas de repaso, SOLO sobre esos conceptos (nada mas del tema general).
Usa un lenguaje de apoyo, preguntas mas simples y directas que refuercen comprension (no que confundan mas).
Distribucion: 2 preguntas "multiple_choice" y 2 preguntas "true_false".

Formato JSON por pregunta:
- multiple_choice: {"type":"multiple_choice","q":"pregunta","opts":["A. op1","B. op2","C. op3","D. op4"],"ok":0,"exp":"explicacion de apoyo","concept_tag":"uno de los conceptos de arriba, exacto"}
- true_false: {"type":"true_false","q":"afirmacion","ok":true,"exp":"explicacion de apoyo","concept_tag":"uno de los conceptos de arriba, exacto"}

${ANTI_HALLUCINATION_BLOCK}

Responde SOLO con JSON valido:
{"questions":[...4 preguntas aqui...]}`;

  const questions = await callCohere(prompt, 4);
  return questions ?? [];
}

export async function POST(req: NextRequest) {
  // Declarados fuera del try para poder usarlos en el manejo de errores.
  let moduleId: string | undefined;
  let supabase: Awaited<ReturnType<typeof createServerSupabase>> | null = null;
  try {
    const body = await req.json();
    moduleId = body.moduleId;
    const { context: clientContext, moduleTitle, aiConfig, remediationConcepts } = body;

    if (moduleId) supabase = await createServerSupabase();

    // La configuracion de IA se lee AQUI, en el servidor, a partir del moduleId.
    // Antes la leia el navegador del estudiante y la mandaba en el cuerpo de la
    // peticion: (a) cualquiera podia inyectar instrucciones propias en el prompt;
    // (b) si esa lectura fallaba o el estudiante no tenia acceso, la configuracion
    // se ignoraba EN SILENCIO y se generaba con valores por defecto; (c) era un
    // segundo camino de lectura que podia divergir del de regeneratePool.
    // El cuerpo solo se usa cuando no hay moduleId (peticion sin modulo real).
    let dbConfig: AiConfigRow | null = null;
    let moduleChosen: string[] | null = null;
    if (moduleId && supabase) {
      const { data: modRow } = await supabase
        .from('content_modules')
        .select('classroom_id, minigame_types')
        .eq('id', moduleId)
        .single();
      moduleChosen = modRow?.minigame_types ?? null;
      if (modRow?.classroom_id) {
        const { data: cfg, error: cfgError } = await supabase
          .from('classroom_ai_config')
          .select('*')
          .eq('classroom_id', modRow.classroom_id)
          .maybeSingle();
        // Un fallo aqui NO debe pasar callado: la clase generaria con valores por defecto.
        if (cfgError) console.error('[GENERATE_CONFIG_READ_FAILED]', { moduleId, error: cfgError.message });
        dbConfig = cfg ?? null;
      }
    }
    const config = resolveConfig(moduleId ? dbConfig : aiConfig);

    // 0. Modo repaso dirigido (Sesion E.1): atajo completo, nunca toca el cache normal.
    if (remediationConcepts?.length > 0 && moduleId && supabase) {
      const questions = await generateRemediationQuestions(supabase, moduleId, moduleTitle, remediationConcepts, config);
      return NextResponse.json({ questions, cached: false });
    }

    // 1. Intentar servir del cache (rapido, sin llamar a Cohere).
    if (moduleId && supabase) {
      const { data: cached } = await supabase
        .from('lesson_questions')
        .select('*')
        .eq('module_id', moduleId);

      // El estudiante sortea entre TODO el pool que sirve: preguntas activas y de
      // reserva, sin las rechazadas. Un cambio de configuracion (p.ej. apagar un
      // minijuego) debe tener efecto sobre lo YA generado, asi que tambien se filtra
      // por los tipos que la clase permite hoy. Ver src/lib/questions/poolServing.ts.
      const validCached = servableQuestions(cached || [], allowedTypeSet(config));

      if (validCached.length >= MIN_CACHE_SIZE) {
        const picked = drawQuestions(validCached, SERVE_COUNT);
        return NextResponse.json({ questions: picked, cached: true });
      }
    }

    // 2. Generacion bajo el bloqueo anti-stampede: solo una por modulo a la vez
    // (Protocolo 7.7.3). Si otra peticion ya esta generando, 202 y el cliente espera
    // y reintenta (la pagina del estudiante lo maneja). El bloqueo solo lo libera
    // quien lo tomo, y caduca: ver src/lib/questions/generationLock.ts.
    const outcome = await withGenerationLock(supabase, moduleId, async () => {
    // 3. Cache insuficiente (o sin moduleId): generar con Cohere.
    if (!process.env.COHERE_API_KEY) {
      return NextResponse.json({ error: 'No API key' }, { status: 500 });
    }

    // Contexto: RAG real cuando hay moduleId (busca en TODA la clase, no solo un material);
    // si no hay moduleId (fallback sin modulo real) se usa el context que mando el cliente.
    let context = clientContext || '';
    if (moduleId && supabase) {
      const ragContext = await getRagContext(supabase, moduleId);
      if (ragContext) context = ragContext;
    }

    // Fase 1.2: taxonomia cerrada de conceptos (Protocolo 7.6). Se genera
    // una sola vez por modulo (primera llamada la crea, el resto la
    // reutiliza) y se inyecta en el prompt para que todas las preguntas del
    // modulo converjan a los mismos concept_tag.
    const closedConcepts = moduleId && supabase
      ? await getOrCreateModuleConcepts(supabase, moduleId, moduleTitle)
      : [];

    // Los tipos base y los minijuegos salen de la configuracion de la clase; el
    // prompt lo construye el mismo codigo que usa regeneratePool
    // (src/lib/questions/generationConfig.ts), asi que no pueden divergir.
    const TOTAL_QUESTIONS = moduleId ? GENERATE_COUNT : SERVE_COUNT;
    const minigameTypes = moduleId ? resolveMinigames({ classAllowed: config.allowedMinigames, moduleChosen }) : [];
    const built = buildGenerationPrompt({
      config,
      moduleTitle,
      context,
      classicCount: TOTAL_QUESTIONS,
      minigames: minigameTypes,
      conceptBlock: conceptTaxonomyPromptBlock(closedConcepts),
    });

    const questions = await callCohere(built.prompt, built.total);
    if (!questions) return NextResponse.json({ error: 'Cohere generation failed' }, { status: 500 });
    // Normaliza cada minijuego a la misma forma anidada (game_type/game_data) que usan
    // las filas servidas desde cache, para que el cliente no tenga que manejar N shapes.
    const generated: any[] = questions.map(normalizeGeneratedQuestion);

    // Defensa en profundidad: el modelo puede ignorar "TIPOS PERMITIDOS". Lo que
    // la configuracion no pidio no llega al estudiante ni se guarda.
    const { kept: onConfig, dropped: offConfig } = enforceAllowedTypes(generated, new Set(built.requestedTypes));
    if (offConfig.length > 0) {
      console.warn('[GENERATION_OFF_CONFIG]', { moduleId, descartadas: offConfig.map((q: any) => q.type) });
    }

    // Sesion I, Fix 1: descartar preguntas/minijuegos con datos incompletos
    // ANTES de guardarlos en cache o servirlos — nunca deben llegar al
    // estudiante en blanco o rotos. isValidQuestion es la misma validacion
    // que usa lesson/[id]/page.tsx para el fallback de "saltar pregunta".
    const validGenerated = onConfig.filter((q) => {
      const check = isValidQuestion(q);
      if (!check.valid) {
        console.warn('[GENERATION_VALIDATION_FAILED]', { type: q.type, error: check.error });
      }
      return check.valid;
    });

    // 3. Guardar lo generado en el cache para las proximas aperturas (best-effort),
    // y recuperar los ids asignados por la base para poder trackear intentos.
    let generatedWithIds = validGenerated;
    if (moduleId && supabase && validGenerated.length > 0) {
      const rows = validGenerated.map((q) => ({
        module_id: moduleId,
        type: q.type,
        q: q.q,
        opts: q.opts ?? null,
        ok: q.ok ?? null,
        answers: q.answers ?? null,
        pairs: q.pairs ?? null,
        keywords: q.keywords ?? null,
        exp: q.exp ?? null,
        concept_tag: q.concept_tag ?? null,
        game_type: q.game_type ?? null,
        game_data: q.game_data ?? null,
      }));
      const { data: inserted } = await supabase.from('lesson_questions').insert(rows).select('id');
      if (inserted && inserted.length === validGenerated.length) {
        generatedWithIds = validGenerated.map((q, i) => ({ ...q, id: inserted[i].id }));
      }
    }

    // El estudiante solo ve SERVE_COUNT, aunque se hayan generado/guardado mas.
    const toServe = moduleId ? shuffle(generatedWithIds).slice(0, SERVE_COUNT) : generatedWithIds;
    return NextResponse.json({ questions: toServe, cached: false });
    });

    if (outcome.status === 'forbidden') {
      // Quien llama no es el profesor de este modulo ni un estudiante inscrito: no se
      // gasta una generacion (cuesta dinero y cuota) para alguien sin acceso.
      return NextResponse.json({ error: 'Sin acceso a este modulo' }, { status: 403 });
    }
    if (outcome.status === 'busy') {
      console.log(`[generate-questions] modulo ${moduleId} ya se esta generando, respondiendo 202`);
      return NextResponse.json(
        { cached: false, message: 'Generación en curso, reintenta en algunos segundos' },
        { status: 202 }
      );
    }
    return outcome.value;
  } catch (e) {
    console.error('Error:', String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
