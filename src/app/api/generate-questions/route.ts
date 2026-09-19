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
import { acquireGenerationLock, releaseGenerationLock } from '@/lib/questions/generationLock';

const MIN_CACHE_SIZE = 5; // debajo de esto, todavia se sirve del cache si alcanza
const SERVE_COUNT = 5; // preguntas que ve el estudiante por leccion
const GENERATE_COUNT = 10; // preguntas generadas por llamada a Cohere (puebla el cache mas rapido)

// Convierte una fila de lesson_questions al shape que espera el render de la leccion.
// Incluye id y concept_tag para que el cliente pueda registrar el intento en question_attempts.
function rowToQuestion(row: any) {
  const q: any = { id: row.id, type: row.type, q: row.q, exp: row.exp, concept_tag: row.concept_tag ?? null };
  if (row.opts) q.opts = row.opts;
  if (row.ok !== null && row.ok !== undefined) q.ok = row.ok;
  if (row.answers) q.answers = row.answers;
  if (row.pairs) q.pairs = row.pairs;
  if (row.keywords) q.keywords = row.keywords;
  if (row.game_type) q.game_type = row.game_type;
  if (row.game_data) q.game_data = row.game_data;
  return q;
}

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
  // Declarados fuera del try para que el finally (liberar el lock
  // anti-stampede) los pueda ver sin importar donde falle el try.
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

      // Mejora Estructural 2: si el modulo tiene pool activo/backup (creado desde
      // un objetivo de aprendizaje configurado por el profesor), servir SOLO del
      // pool activo (is_backup=false) y dejar el resto como reserva. Los modulos
      // auto-generados de siempre no usan este flujo (todas sus filas ya son
      // is_backup=false por default), asi que este filtro no les cambia nada.
      const activePool = (cached || []).filter((row: any) => !row.is_backup);
      const poolToUse = activePool.length > 0 ? activePool : (cached || []);

      // Sesion I, Fix 1: filtrar filas invalidas del cache (pueden existir de
      // antes de este fix, o de una generacion que se colo con datos incompletos).
      // Un cambio de configuracion (p.ej. apagar un minijuego) debe tener efecto sobre
      // lo YA generado: el cache no puede seguir sirviendo tipos que la clase desactivo.
      const allowedNow = allowedTypeSet(config);
      const validCached = poolToUse
        .map(rowToQuestion)
        .filter((q) => isValidQuestion(q).valid)
        .filter((q) => allowedNow.has(q.type));

      if (validCached.length >= MIN_CACHE_SIZE) {
        const picked = shuffle(validCached).slice(0, SERVE_COUNT);
        return NextResponse.json({ questions: picked, cached: true });
      }
    }

    // 2. Lock anti-stampede: solo una generación por módulo simultáneamente
    // (Protocolo 7.7.3). Si otro request ya está generando, devolver 202 Accepted
    // para que el cliente reutilice caché o reintente después.
    if (moduleId && supabase) {
      const lockAcquired = await acquireGenerationLock(supabase, moduleId);
      if (!lockAcquired) {
        console.log(`[generate-questions] Lock not acquired for module ${moduleId}, returning 202`);
        return NextResponse.json(
          { cached: false, message: 'Generación en curso, reintenta en algunos segundos' },
          { status: 202 }
        );
      }
    }

    // 3. Cache insuficiente (o sin moduleId): generar con Cohere como antes.
    const COHERE_API_KEY = process.env.COHERE_API_KEY;
    if (!COHERE_API_KEY) {
      if (moduleId && supabase) await releaseGenerationLock(supabase, moduleId);
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
  } catch (e) {
    console.error('Error:', String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    // Liberar el lock si fue adquirido
    if (moduleId && supabase) {
      await releaseGenerationLock(supabase, moduleId);
    }
  }
}
