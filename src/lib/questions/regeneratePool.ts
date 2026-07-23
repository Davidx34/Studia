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
} from '@/lib/questions/cohereGeneration';

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
  const totalToGenerate = questionCount + backupCount;

  const context = await getRagContext(supabase, moduleId);

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

  const activeTypes = types.length > 0 ? types : ['opcion_multiple'];
  const base = Math.floor(totalToGenerate / activeTypes.length);
  let remainder = totalToGenerate % activeTypes.length;
  const counts = activeTypes.map(() => base + (remainder-- > 0 ? 1 : 0));

  let typeInstructions = activeTypes
    .map((t, i) => `- ${counts[i]} pregunta(s) de tipo "${t}", con este formato JSON: ${jsonFormats[t]}`)
    .join('\n');

  // A diferencia de generate-questions (que sortea minijuegos al azar), aqui se
  // usan EXACTAMENTE los tipos que el profesor eligio para este modulo.
  const configuredMinigames = (moduleRow.minigame_types || []).filter((mg: string) => mg in MINIGAME_RULES);
  for (const mg of configuredMinigames) {
    typeInstructions += `\n- 1 pregunta adicional de tipo "${mg}" ${MINIGAME_RULES[mg]}; si no aplica, genera en su lugar una pregunta mas de los tipos de arriba. Formato JSON: ${jsonFormats[mg]}`;
  }
  const totalWithMinigames = totalToGenerate + configuredMinigames.length;

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
${(context || '').substring(0, 1500)}

Genera EXACTAMENTE ${totalWithMinigames} preguntas, distribuidas asi (respeta la cantidad exacta de cada tipo, no generes solo un tipo):
${typeInstructions}

No repitas preguntas ni reformules la misma idea dos veces; cada pregunta debe cubrir un aspecto distinto del tema.

REGLAS ADICIONALES POR TIPO:
- short_answer: la pregunta debe ser especifica y acotada (nunca vaga tipo "¿que es importante?"), con una respuesta esperada clara. "keywords" debe tener entre 2 y 5 palabras u expresiones concretas que se esperan en la respuesta.
- fill_blank: "q" debe tener UN SOLO espacio en blanco marcado con "___", y "answers" debe tener exactamente 1 palabra o frase corta que lo completa (no varios blancos en la misma oracion).
- match: "pairs" debe tener entre 3 y 4 pares concepto-definicion, cada uno claramente distinto de los demas para evitar ambiguedad.
${MINIGAME_TYPE_RULES_TEXT}

NOTACION MATEMATICA: si el contenido requiere formulas, ecuaciones o simbolos matematicos (ej: funciones, derivadas, condiciones de optimizacion), escribelos en LaTeX: usa $...$ para notacion inline (ej: $U(x,y) = x^{0.5}y^{0.5}$) y $$...$$ para ecuaciones en bloque. No uses LaTeX si el tema no lo requiere.

CONCEPT_TAG (obligatorio en cada pregunta): identifica el concepto especifico que evalua la pregunta (no el tema general del modulo), como un identificador snake_case corto en español (ej: "revolucion_industrial_causas", "fotosintesis_clorofila"). Si dos preguntas evaluan el mismo concepto especifico, deben usar EXACTAMENTE el mismo concept_tag.

Responde SOLO con JSON valido:
{"questions":[...${totalWithMinigames} preguntas aqui, en el orden y cantidad indicados arriba...]}`;

  const questions = await callCohere(prompt);
  if (!questions) return { ok: false, error: 'Cohere generation failed' };

  const generated = questions.map(normalizeGeneratedQuestion);
  const validGenerated = generated.filter((q: any) => {
    const check = isValidQuestion(q);
    if (!check.valid) {
      console.warn('[REGENERATE_VALIDATION_FAILED]', { type: q.type, error: check.error });
    }
    return check.valid;
  });

  if (validGenerated.length === 0) {
    return { ok: false, error: 'No se genero ninguna pregunta valida' };
  }

  // Reemplaza el pool existente del modulo por el nuevo (activo + backup).
  await supabase.from('lesson_questions').delete().eq('module_id', moduleId);

  const activeQuestions = validGenerated.slice(0, questionCount);
  const backupQuestions = validGenerated.slice(questionCount);

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
