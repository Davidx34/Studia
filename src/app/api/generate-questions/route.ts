import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { isValidQuestion } from '@/lib/lesson/validateQuestion';
import {
  shuffle,
  getRagContext,
  jsonFormats,
  MINIGAME_RULES,
  MINIGAME_TYPE_RULES_TEXT,
  normalizeGeneratedQuestion,
  callCohere,
} from '@/lib/questions/cohereGeneration';

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
  weakConcepts: string[]
): Promise<any[]> {
  const COHERE_API_KEY = process.env.COHERE_API_KEY;
  if (!COHERE_API_KEY) return [];

  const context = await getRagContext(supabase, moduleId);

  const prompt = `Eres un profesor de apoyo haciendo un repaso corto y alentador con un estudiante.

TEMA DEL MODULO: ${moduleTitle}
CONTENIDO DEL MATERIAL:
${(context || '').substring(0, 1500)}

El estudiante tuvo dificultad especificamente con estos conceptos: ${weakConcepts.join(', ')}.

Genera EXACTAMENTE 4 preguntas de repaso, SOLO sobre esos conceptos (nada mas del tema general).
Usa un lenguaje de apoyo, preguntas mas simples y directas que refuercen comprension (no que confundan mas).
Distribucion: 2 preguntas "multiple_choice" y 2 preguntas "true_false".

Formato JSON por pregunta:
- multiple_choice: {"type":"multiple_choice","q":"pregunta","opts":["A. op1","B. op2","C. op3","D. op4"],"ok":0,"exp":"explicacion de apoyo","concept_tag":"uno de los conceptos de arriba, exacto"}
- true_false: {"type":"true_false","q":"afirmacion","ok":true,"exp":"explicacion de apoyo","concept_tag":"uno de los conceptos de arriba, exacto"}

Responde SOLO con JSON valido:
{"questions":[...4 preguntas aqui...]}`;

  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + COHERE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'c4ai-aya-expanse-32b', messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const text = data.message?.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.questions || [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const { moduleId, context: clientContext, moduleTitle, aiConfig, remediationConcepts } = await req.json();

    let supabase: Awaited<ReturnType<typeof createServerSupabase>> | null = null;
    if (moduleId) supabase = await createServerSupabase();

    // 0. Modo repaso dirigido (Sesion E.1): atajo completo, nunca toca el cache normal.
    if (remediationConcepts?.length > 0 && moduleId && supabase) {
      const questions = await generateRemediationQuestions(supabase, moduleId, moduleTitle, remediationConcepts);
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
      const validCached = poolToUse.map(rowToQuestion).filter((q) => isValidQuestion(q).valid);

      if (validCached.length >= MIN_CACHE_SIZE) {
        const picked = shuffle(validCached).slice(0, SERVE_COUNT);
        return NextResponse.json({ questions: picked, cached: true });
      }
    }

    // 2. Cache insuficiente (o sin moduleId): generar con Cohere como antes.
    const COHERE_API_KEY = process.env.COHERE_API_KEY;
    if (!COHERE_API_KEY) return NextResponse.json({ error: 'No API key' }, { status: 500 });

    // Contexto: RAG real cuando hay moduleId (busca en TODA la clase, no solo un material);
    // si no hay moduleId (fallback sin modulo real) se usa el context que mando el cliente.
    let context = clientContext || '';
    if (moduleId && supabase) {
      const ragContext = await getRagContext(supabase, moduleId);
      if (ragContext) context = ragContext;
    }

    const skills = [];
    if (aiConfig?.skill_memory) skills.push('recordar hechos');
    if (aiConfig?.skill_comprehension) skills.push('comprender conceptos');
    if (aiConfig?.skill_application) skills.push('aplicar conocimiento');
    if (aiConfig?.skill_analysis) skills.push('analizar y descomponer');
    if (aiConfig?.skill_synthesis) skills.push('sintetizar ideas');
    if (aiConfig?.skill_evaluation) skills.push('evaluar criticamente');

    const types = [];
    if (aiConfig?.type_multiple_choice) types.push('opcion_multiple');
    if (aiConfig?.type_true_false) types.push('verdadero_falso');
    if (aiConfig?.type_fill_blank) types.push('completar_frase');
    if (aiConfig?.type_match) types.push('conectar_conceptos');
    if (aiConfig?.type_short_answer) types.push('respuesta_corta');

    const depth = aiConfig?.question_depth || 3;
    const langLevel = aiConfig?.language_level || 'intermediate';
    const customInstructions = aiConfig?.custom_instructions || '';
    const goodExample = aiConfig?.example_good_question || '';
    const badExample = aiConfig?.example_bad_question || '';
    const emphasize = aiConfig?.topics_emphasize || '';
    const avoid = aiConfig?.topics_avoid || '';
    const gradeDetail = aiConfig?.grade_level_detail || '';
    const subjectDesc = aiConfig?.subject_description || '';

    // Minijuegos disponibles como "bonus" fuera de la distribucion normal (no le
    // roban cupo a los tipos que el profesor configuro). Maximo 2 minijuegos por
    // modulo para no perder variedad pedagogica: si hay mas de 2 tipos disponibles,
    // se sortean 2 por generacion en vez de pedirlos todos.
    const MAX_MINIGAMES_PER_MODULE = 2;

    // Distribuir exactamente TOTAL_QUESTIONS entre los tipos activos (nunca solo opcion_multiple
    // si hay mas tipos habilitados). Sin esto, Cohere tiende a generar todo opcion_multiple.
    const TOTAL_QUESTIONS = moduleId ? GENERATE_COUNT : SERVE_COUNT;
    const activeTypes = types.length > 0 ? types : ['opcion_multiple'];
    const base = Math.floor(TOTAL_QUESTIONS / activeTypes.length);
    let remainder = TOTAL_QUESTIONS % activeTypes.length;
    const counts = activeTypes.map(() => base + (remainder-- > 0 ? 1 : 0));

    let typeInstructions = activeTypes
      .map((t, i) => `- ${counts[i]} pregunta(s) de tipo "${t}", con este formato JSON: ${jsonFormats[t]}`)
      .join('\n');

    // Los minijuegos son un bonus fuera de la distribucion normal: solo tienen
    // sentido cuando hay un modulo real (se cachean/trackean como el resto), y
    // solo si el tema efectivamente se presta para ese formato (si no aplica,
    // Cohere genera en su lugar una pregunta mas de los tipos configurados).
    const minigameTypes = moduleId ? shuffle(Object.keys(MINIGAME_RULES)).slice(0, MAX_MINIGAMES_PER_MODULE) : [];
    for (const mg of minigameTypes) {
      typeInstructions += `\n- 1 pregunta adicional de tipo "${mg}" ${MINIGAME_RULES[mg]}; si no aplica, genera en su lugar una pregunta mas de los tipos de arriba. Formato JSON: ${jsonFormats[mg]}`;
    }
    const TOTAL_WITH_MINIGAME = TOTAL_QUESTIONS + minigameTypes.length;

    const prompt = `Eres un profesor experto generando preguntas de evaluacion.

MATERIA: ${subjectDesc || moduleTitle}
GRADO: ${gradeDetail}
TEMA DEL MODULO: ${moduleTitle}
NIVEL DE PROFUNDIDAD: ${depth}/5
NIVEL DE LENGUAJE: ${langLevel}
HABILIDADES A EVALUAR: ${skills.join(', ') || 'comprension general'}
${emphasize ? 'TEMAS A ENFATIZAR: ' + emphasize : ''}
${avoid ? 'TEMAS A EVITAR: ' + avoid : ''}
${customInstructions ? 'INSTRUCCIONES ESPECIALES: ' + customInstructions : ''}
${goodExample ? 'EJEMPLO DE PREGUNTA IDEAL: ' + goodExample : ''}
${badExample ? 'PREGUNTA A EVITAR: ' + badExample : ''}

CONTENIDO DEL MATERIAL:
${(context || '').substring(0, 1500)}

Genera EXACTAMENTE ${TOTAL_WITH_MINIGAME} preguntas, distribuidas asi (respeta la cantidad exacta de cada tipo, no generes solo un tipo):
${typeInstructions}

No repitas preguntas ni reformules la misma idea dos veces; cada pregunta debe cubrir un aspecto distinto del tema.

REGLAS ADICIONALES POR TIPO:
- short_answer: la pregunta debe ser especifica y acotada (nunca vaga tipo "¿que es importante?"), con una respuesta esperada clara. "keywords" debe tener entre 2 y 5 palabras u expresiones concretas que se esperan en la respuesta.
- fill_blank: "q" debe tener UN SOLO espacio en blanco marcado con "___", y "answers" debe tener exactamente 1 palabra o frase corta que lo completa (no varios blancos en la misma oracion).
- match: "pairs" debe tener entre 3 y 4 pares concepto-definicion, cada uno claramente distinto de los demas para evitar ambiguedad.
${MINIGAME_TYPE_RULES_TEXT}

CONCEPT_TAG (obligatorio en cada pregunta): identifica el concepto especifico que evalua la pregunta (no el tema general del modulo), como un identificador snake_case corto en español (ej: "revolucion_industrial_causas", "fotosintesis_clorofila"). Si dos preguntas evaluan el mismo concepto especifico, deben usar EXACTAMENTE el mismo concept_tag.

Responde SOLO con JSON valido:
{"questions":[...${TOTAL_WITH_MINIGAME} preguntas aqui, en el orden y cantidad indicados arriba...]}`;

    const questions = await callCohere(prompt);
    if (!questions) return NextResponse.json({ error: 'Cohere generation failed' }, { status: 500 });
    // Normaliza cada minijuego a la misma forma anidada (game_type/game_data) que usan
    // las filas servidas desde cache, para que el cliente no tenga que manejar N shapes.
    const generated: any[] = questions.map(normalizeGeneratedQuestion);

    // Sesion I, Fix 1: descartar preguntas/minijuegos con datos incompletos
    // ANTES de guardarlos en cache o servirlos — nunca deben llegar al
    // estudiante en blanco o rotos. isValidQuestion es la misma validacion
    // que usa lesson/[id]/page.tsx para el fallback de "saltar pregunta".
    const validGenerated = generated.filter((q) => {
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
  }
}
