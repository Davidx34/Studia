// Mejora Estructural 2: logica compartida para (re)generar el pool completo
// (activo + backup) de un modulo configurado por el profesor. La usan tanto
// /api/regenerate-module-questions (llamada desde fetch del cliente) como el
// server action regenerateModulePool (botón en la UI de objetivos), para no
// duplicar el prompt ni la logica de guardado en dos lugares.

import { isValidQuestion } from '@/lib/lesson/validateQuestion';
import {
  getRagContext,
  jsonFormats,
  MINIGAME_RULES,
  MINIGAME_TYPE_RULES_TEXT,
  normalizeGeneratedQuestion,
  callCohere,
  RAG_CONTEXT_CHAR_LIMIT,
  ANTI_HALLUCINATION_BLOCK,
  typeInstructionLine,
} from '@/lib/questions/cohereGeneration';
import { getOrCreateModuleConcepts, conceptTaxonomyPromptBlock } from '@/lib/questions/conceptTaxonomy';

const DEFAULT_QUESTION_COUNT = 10;
const MIN_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 15;

export interface RegeneratePoolResult {
  ok: boolean;
  active?: number;
  backup?: number;
  error?: string;
}

export async function regenerateModulePool(supabase: any, moduleId: string): Promise<RegeneratePoolResult> {
  const { data: moduleRow, error: moduleError } = await supabase
    .from('content_modules')
    .select('id, classroom_id, title, description, minigame_types, configured_question_count')
    .eq('id', moduleId)
    .single();

  // RLS de content_modules ya restringe esto al profesor dueno del modulo, asi
  // que un moduleRow nulo aqui significa que no existe o no le pertenece al
  // usuario autenticado en este supabase client.
  if (moduleError || !moduleRow) {
    return { ok: false, error: 'Modulo no encontrado' };
  }

  const { data: aiConfig } = await supabase
    .from('classroom_ai_config')
    .select('*')
    .eq('classroom_id', moduleRow.classroom_id)
    .maybeSingle();

  if (!process.env.COHERE_API_KEY) return { ok: false, error: 'No API key' };

  const questionCount = Math.min(
    MAX_QUESTION_COUNT,
    Math.max(MIN_QUESTION_COUNT, moduleRow.configured_question_count || DEFAULT_QUESTION_COUNT)
  );
  const backupCount = questionCount; // reserva = 100% extra, per Mejora Estructural 2

  const context = await getRagContext(supabase, moduleId);

  // Fase 1.2: taxonomia cerrada de conceptos (Protocolo 7.6) -- ver
  // src/lib/questions/conceptTaxonomy.ts. regeneratePool es el flujo del
  // profesor (boton "Regenerar pool" en /teacher/classrooms/[id]/objectives),
  // asi que casi siempre corre DESPUES de generate-questions y reutiliza la
  // taxonomia ya creada; si el profesor regenera antes de que exista, la crea.
  const closedConcepts = await getOrCreateModuleConcepts(supabase, moduleId, moduleRow.title);

  const skills: string[] = [];
  if (aiConfig?.skill_memory) skills.push('recordar hechos');
  if (aiConfig?.skill_comprehension) skills.push('comprender conceptos');
  if (aiConfig?.skill_application) skills.push('aplicar conocimiento');
  if (aiConfig?.skill_analysis) skills.push('analizar y descomponer');
  if (aiConfig?.skill_synthesis) skills.push('sintetizar ideas');
  if (aiConfig?.skill_evaluation) skills.push('evaluar criticamente');

  const types: string[] = [];
  if (aiConfig?.type_multiple_choice) types.push('opcion_multiple');
  if (aiConfig?.type_true_false) types.push('verdadero_falso');
  if (aiConfig?.type_fill_blank) types.push('completar_frase');
  if (aiConfig?.type_match) types.push('conectar_conceptos');
  if (aiConfig?.type_short_answer) types.push('respuesta_corta');
  const activeTypes = types.length > 0 ? types : ['opcion_multiple'];

  const depth = aiConfig?.question_depth || 3;
  const langLevel = aiConfig?.language_level || 'intermediate';
  const customInstructions = aiConfig?.custom_instructions || '';
  const goodExample = aiConfig?.example_good_question || '';
  const badExample = aiConfig?.example_bad_question || '';
  const emphasize = aiConfig?.topics_emphasize || '';
  const avoid = aiConfig?.topics_avoid || '';
  const gradeDetail = aiConfig?.grade_level_detail || '';
  const subjectDesc = aiConfig?.subject_description || '';

  // A diferencia de generate-questions (que sortea minijuegos al azar), aqui se
  // usan EXACTAMENTE los tipos que el profesor eligio para este modulo.
  const configuredMinigames = (moduleRow.minigame_types || []).filter((mg: string) => mg in MINIGAME_RULES);

  // Genera un lote de N preguntas en una sola llamada a Cohere. Separado en
  // funcion porque el pool completo (activo+backup, hasta 30) excedia el
  // limite DURO de salida del modelo (4096 tokens -- c4ai-aya-expanse-32b
  // rechaza con HTTP 400 pedir mas, verificado en vivo) y, sin ese limite
  // explicito, la respuesta se truncaba a mitad de un JSON en vez de fallar
  // con un error claro. Pedir el pool en 2 llamadas mas chicas (activas,
  // backup) en vez de 1 sola mantiene cada peticion comodamente por debajo
  // del techo. Los minijuegos (mas pesados en tokens) solo van en el batch
  // activo -- el backup es reserva simple, no necesita la misma variedad.
  async function generateBatch(count: number, includeMinigames: boolean): Promise<any[] | null> {
    if (count <= 0) return [];
    const batchTypes = activeTypes.length > 0 ? activeTypes : ['opcion_multiple'];
    const base = Math.floor(count / batchTypes.length);
    let remainder = count % batchTypes.length;
    const counts = batchTypes.map(() => base + (remainder-- > 0 ? 1 : 0));

    let typeInstructions = batchTypes
      .map((t: string, i: number) => typeInstructionLine(t, counts[i]))
      .join('\n');

    const minigamesForBatch = includeMinigames ? configuredMinigames : [];
    for (const mg of minigamesForBatch) {
      typeInstructions += `\n- 1 pregunta adicional de tipo "${mg}" ${MINIGAME_RULES[mg]}; si no aplica, genera en su lugar una pregunta mas de los tipos de arriba. Formato JSON: ${jsonFormats[mg]}`;
    }
    const totalForBatch = count + minigamesForBatch.length;

    const prompt = `Eres un profesor experto generando preguntas de evaluacion.

MATERIA: ${subjectDesc || moduleRow.title}
GRADO: ${gradeDetail}
TEMA DEL MODULO: ${moduleRow.title}
NIVEL DE PROFUNDIDAD: ${depth}/5
NIVEL DE LENGUAJE: ${langLevel}
HABILIDADES A EVALUAR: ${skills.join(', ') || 'comprension general'}
${emphasize ? 'TEMAS A ENFATIZAR: ' + emphasize : ''}
${avoid ? 'TEMAS A EVITAR: ' + avoid : ''}
${customInstructions ? 'INSTRUCCIONES ESPECIALES: ' + customInstructions : ''}
${goodExample ? 'EJEMPLO DE PREGUNTA IDEAL: ' + goodExample : ''}
${badExample ? 'PREGUNTA A EVITAR: ' + badExample : ''}

CONTENIDO DEL MATERIAL:
${(context || '').substring(0, RAG_CONTEXT_CHAR_LIMIT)}

Genera EXACTAMENTE ${totalForBatch} preguntas, distribuidas asi (respeta la cantidad exacta de cada tipo, no generes solo un tipo):
${typeInstructions}

No repitas preguntas ni reformules la misma idea dos veces; cada pregunta debe cubrir un aspecto distinto del tema.

REGLAS ADICIONALES POR TIPO:
- short_answer: la pregunta debe ser especifica y acotada (nunca vaga tipo "¿que es importante?"), con una respuesta esperada clara. "keywords" debe tener entre 2 y 5 palabras u expresiones concretas que se esperan en la respuesta.
- fill_blank: "q" debe tener UN SOLO espacio en blanco marcado con "___", y "answers" debe tener exactamente 1 palabra o frase corta que lo completa (no varios blancos en la misma oracion).
- match: "pairs" debe tener entre 3 y 4 pares concepto-definicion, cada uno claramente distinto de los demas para evitar ambiguedad.
${includeMinigames ? MINIGAME_TYPE_RULES_TEXT : ''}

NOTACION MATEMATICA: si el contenido requiere formulas, ecuaciones o simbolos matematicos (ej: funciones, derivadas, condiciones de optimizacion), escribelos en LaTeX: usa $...$ para notacion inline (ej: $U(x,y) = x^{0.5}y^{0.5}$) y $$...$$ para ecuaciones en bloque. No uses LaTeX si el tema no lo requiere.

${conceptTaxonomyPromptBlock(closedConcepts) || 'CONCEPT_TAG (obligatorio en cada pregunta): identifica el concepto especifico que evalua la pregunta (no el tema general del modulo), como un identificador snake_case corto en español (ej: "revolucion_industrial_causas", "fotosintesis_clorofila"). Si dos preguntas evaluan el mismo concepto especifico, deben usar EXACTAMENTE el mismo concept_tag.'}

${ANTI_HALLUCINATION_BLOCK}

Responde SOLO con JSON valido:
{"questions":[...${totalForBatch} preguntas aqui, en el orden y cantidad indicados arriba...]}`;

    return callCohere(prompt, totalForBatch);
  }

  const [activeRaw, backupRaw] = await Promise.all([
    generateBatch(questionCount, true),
    generateBatch(backupCount, false),
  ]);

  if (!activeRaw && !backupRaw) {
    return { ok: false, error: 'Cohere generation failed tras reintentos' };
  }

  const normalizeValidate = (raw: any[] | null) =>
    (raw ?? []).map(normalizeGeneratedQuestion).filter((q: any) => {
      const check = isValidQuestion(q);
      if (!check.valid) {
        console.warn('[REGENERATE_VALIDATION_FAILED]', { type: q.type, error: check.error });
      }
      return check.valid;
    });

  const activeQuestions = normalizeValidate(activeRaw);
  const backupQuestions = normalizeValidate(backupRaw);
  const validGenerated = [...activeQuestions, ...backupQuestions];

  if (validGenerated.length === 0) {
    return { ok: false, error: 'No se genero ninguna pregunta valida' };
  }

  // Reemplaza el pool existente del modulo por el nuevo (activo + backup).
  await supabase.from('lesson_questions').delete().eq('module_id', moduleId);

  const rows = [...activeQuestions, ...backupQuestions].map((q, i) => ({
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
    is_backup: i >= activeQuestions.length,
    backup_pool_size: backupQuestions.length,
  }));

  const { error: insertError } = await supabase.from('lesson_questions').insert(rows);
  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  return { ok: true, active: activeQuestions.length, backup: backupQuestions.length };
}
