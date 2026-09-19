// Como la configuracion de IA de la clase (classroom_ai_config) se convierte en
// lo que se le pide al generador. Logica pura: sin red, sin base de datos.
//
// Por que existe: el prompt de generacion estaba escrito DOS veces --
// /api/generate-questions (cuando el estudiante abre la leccion) y
// regeneratePool (cuando el profesor regenera el pool) -- y las dos copias ya
// habian divergido: una sorteaba los minijuegos al azar, la otra usaba solo los
// del modulo. Auditando los 23 campos de la configuracion se encontro ademas que
// tres no llegaban a NINGUNA de las dos copias (learning_objectives, type_order y
// question_style). Un solo constructor hace que un campo se use en los dos
// caminos o en ninguno, y generationConfig.test.ts falla si aparece una columna
// nueva sin decidir que se hace con ella.

import type { Database } from '@/types/database.generated';
import {
  jsonFormats,
  typeInstructionLine,
  MINIGAME_TYPE_RULES_TEXT,
  RAG_CONTEXT_CHAR_LIMIT,
  ANTI_HALLUCINATION_BLOCK,
} from '@/lib/questions/cohereGeneration';
import {
  ALL_MINIGAME_IDS,
  MAX_MINIGAMES_PER_BATCH,
  sanitizeMinigameIds,
} from '@/lib/questions/minigameCatalog';

export type AiConfigRow = Partial<Database['public']['Tables']['classroom_ai_config']['Row']>;

// Los valores por defecto de la base (migraciones de classroom_ai_config y 045).
// Una clase SIN fila de configuracion usa exactamente esto -- es lo que la
// pantalla del Cerebro de la IA muestra como "activo" antes de guardar. Antes,
// sin fila, todos los flags eran undefined y la clase generaba SOLO opcion
// multiple, aunque la pantalla mostrara cuatro tipos encendidos.
const DEFAULTS = {
  skill_memory: true,
  skill_comprehension: true,
  skill_application: true,
  skill_analysis: false,
  skill_synthesis: false,
  skill_evaluation: false,
  type_multiple_choice: true,
  type_true_false: true,
  type_fill_blank: true,
  type_match: true,
  type_short_answer: false,
  question_depth: 3,
  language_level: 'intermediate',
} as const;

// [columna de la configuracion, nombre en el prompt, valor del campo "type" en el JSON]
const CLASSIC_TYPES = [
  ['type_multiple_choice', 'opcion_multiple', 'multiple_choice'],
  ['type_true_false', 'verdadero_falso', 'true_false'],
  ['type_fill_blank', 'completar_frase', 'fill_blank'],
  ['type_match', 'conectar_conceptos', 'match'],
  ['type_short_answer', 'respuesta_corta', 'short_answer'],
] as const;

const SKILLS = [
  ['skill_memory', 'recordar hechos'],
  ['skill_comprehension', 'comprender conceptos'],
  ['skill_application', 'aplicar conocimiento'],
  ['skill_analysis', 'analizar y descomponer'],
  ['skill_synthesis', 'sintetizar ideas'],
  ['skill_evaluation', 'evaluar criticamente'],
] as const;

export interface ResolvedConfig {
  subjectDescription: string;
  gradeDetail: string;
  learningObjectives: string;
  skills: string[];
  depth: number;
  languageLevel: string;
  customInstructions: string;
  goodExample: string;
  badExample: string;
  emphasize: string;
  avoid: string;
  // Tipos base activos; nunca vacio (si el profesor apago todos, queda opcion multiple).
  classicTypes: { promptName: string; jsonType: string }[];
  // Minijuegos permitidos para TODA la clase (lista de permitidos).
  allowedMinigames: string[];
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function resolveConfig(row: AiConfigRow | null | undefined): ResolvedConfig {
  const flag = (key: keyof typeof DEFAULTS): boolean => {
    const v = (row as any)?.[key];
    return typeof v === 'boolean' ? v : (DEFAULTS[key] as boolean);
  };

  const classicTypes = CLASSIC_TYPES.filter(([col]) => flag(col)).map(([, promptName, jsonType]) => ({ promptName, jsonType }));

  return {
    subjectDescription: text(row?.subject_description),
    gradeDetail: text(row?.grade_level_detail),
    learningObjectives: text(row?.learning_objectives),
    skills: SKILLS.filter(([col]) => flag(col)).map(([, label]) => label),
    depth: typeof row?.question_depth === 'number' && row.question_depth > 0 ? row.question_depth : DEFAULTS.question_depth,
    languageLevel: text(row?.language_level) || DEFAULTS.language_level,
    customInstructions: text(row?.custom_instructions),
    goodExample: text(row?.example_good_question),
    badExample: text(row?.example_bad_question),
    emphasize: text(row?.topics_emphasize),
    avoid: text(row?.topics_avoid),
    classicTypes: classicTypes.length > 0 ? classicTypes : [{ promptName: 'opcion_multiple', jsonType: 'multiple_choice' }],
    // Sin fila o sin valor: todos (comportamiento anterior). Arreglo vacio: ninguno.
    allowedMinigames: row?.minigame_types == null ? [...ALL_MINIGAME_IDS] : sanitizeMinigameIds(row.minigame_types),
  };
}

// Barajado con generador inyectable, para poder testear sin azar.
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Que minijuegos entran en una tanda de preguntas.
//   - La lista de la CLASE es la de permitidos: nada fuera de ella se genera,
//     pase lo que pase con la eleccion del modulo.
//   - Si el profesor fijo una lista para el MODULO (pantalla de Objetivos), se usa
//     esa, recortada a lo permitido. Si todo lo que eligio esta desactivado en la
//     clase, no hay minijuegos: la configuracion de la clase gana.
//   - Si no fijo lista para el modulo, se sortean hasta `max` de los permitidos.
export function resolveMinigames(opts: {
  classAllowed: readonly string[];
  moduleChosen?: unknown;
  max?: number;
  rng?: () => number;
}): string[] {
  const { classAllowed, max = MAX_MINIGAMES_PER_BATCH, rng = Math.random } = opts;
  if (classAllowed.length === 0) return [];

  const chosen = sanitizeMinigameIds(opts.moduleChosen);
  if (chosen.length > 0) return chosen.filter((id) => classAllowed.includes(id));

  return shuffled(classAllowed, rng).slice(0, max);
}

// Valores del campo "type" que la clase acepta: los tipos base activos y los
// minijuegos permitidos. Sirve para descartar lo que el modelo genere de mas.
export function allowedTypeSet(config: ResolvedConfig, minigames: readonly string[] = config.allowedMinigames): Set<string> {
  return new Set([...config.classicTypes.map((t) => t.jsonType), ...minigames]);
}

// Descarta las preguntas cuyo tipo la configuracion no permite. Se aplica a lo
// que devuelve el modelo (que puede ignorar el prompt) y a lo que se sirve desde
// el cache (que puede haberse generado antes de un cambio de configuracion).
export function enforceAllowedTypes<T extends { type?: string }>(
  questions: readonly T[],
  allowed: ReadonlySet<string>
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const q of questions) (q.type && allowed.has(q.type) ? kept : dropped).push(q);
  return { kept, dropped };
}

// Solo las lineas de reglas de los minijuegos que de verdad se piden. Pasarle al
// modelo las reglas de los ocho invita a generar los que el profesor apago.
function minigameRulesFor(ids: readonly string[]): string {
  const lines = MINIGAME_TYPE_RULES_TEXT.split('\n').filter((l) => ids.some((id) => l.startsWith(`- ${id}:`)));
  return lines.length > 0 ? '\n' + lines.join('\n') : '';
}

// Reglas por tipo base; solo se incluyen las de los tipos activos.
const CLASSIC_RULES: Record<string, string> = {
  short_answer:
    '- short_answer: la pregunta debe ser especifica y acotada (nunca vaga tipo "¿que es importante?"), con una respuesta esperada clara. "keywords" debe tener entre 2 y 5 palabras u expresiones concretas que se esperan en la respuesta.',
  fill_blank:
    '- fill_blank: "q" debe tener UN SOLO espacio en blanco marcado con "___", y "answers" debe tener exactamente 1 palabra o frase corta que lo completa (no varios blancos en la misma oracion).',
  match:
    '- match: "pairs" debe tener entre 3 y 4 pares concepto-definicion, cada uno claramente distinto de los demas para evitar ambiguedad.',
};

const GENERIC_CONCEPT_TAG_BLOCK =
  'CONCEPT_TAG (obligatorio en cada pregunta): identifica el concepto especifico que evalua la pregunta (no el tema general del modulo), como un identificador snake_case corto en español (ej: "revolucion_industrial_causas", "fotosintesis_clorofila"). Si dos preguntas evaluan el mismo concepto especifico, deben usar EXACTAMENTE el mismo concept_tag.';

export interface BuildPromptInput {
  config: ResolvedConfig;
  moduleTitle: string;
  // Contexto RAG ya armado; aqui solo se aplica el tope de caracteres.
  context: string;
  // Cuantas preguntas de tipos BASE pedir en esta tanda.
  classicCount: number;
  // Minijuegos a pedir en esta tanda (ya resueltos con resolveMinigames).
  minigames: readonly string[];
  // Bloque de la taxonomia cerrada de conceptos; vacio usa la instruccion generica.
  conceptBlock?: string;
}

export interface BuiltPrompt {
  prompt: string;
  total: number;
  // Valores de "type" que este prompt pide; lo que llegue de otro tipo sobra.
  requestedTypes: string[];
}

export function buildGenerationPrompt(input: BuildPromptInput): BuiltPrompt {
  const { config: c, moduleTitle, classicCount } = input;
  const minigames = [...input.minigames];

  const base = Math.floor(classicCount / c.classicTypes.length);
  let remainder = classicCount % c.classicTypes.length;
  const counts = c.classicTypes.map(() => base + (remainder-- > 0 ? 1 : 0));

  let typeInstructions = c.classicTypes.map((t, i) => typeInstructionLine(t.promptName, counts[i])).join('\n');
  for (const mg of minigames) {
    typeInstructions += `\n- 1 pregunta adicional de tipo "${mg}" (minijuego); si no aplica al tema, genera en su lugar una pregunta mas de los tipos base de arriba. Formato JSON: ${jsonFormats[mg]}`;
  }
  const total = classicCount + minigames.length;
  const requestedTypes = [...c.classicTypes.map((t) => t.jsonType), ...minigames];

  const header = [
    `MATERIA: ${c.subjectDescription || moduleTitle}`,
    `GRADO: ${c.gradeDetail}`,
    c.learningObjectives ? `OBJETIVOS DE APRENDIZAJE DE LA CLASE: ${c.learningObjectives}` : '',
    `TEMA DEL MODULO: ${moduleTitle}`,
    `NIVEL DE PROFUNDIDAD: ${c.depth}/5`,
    `NIVEL DE LENGUAJE: ${c.languageLevel}`,
    `HABILIDADES A EVALUAR: ${c.skills.join(', ') || 'comprension general'}`,
    c.emphasize ? `TEMAS A ENFATIZAR: ${c.emphasize}` : '',
    c.avoid ? `TEMAS A EVITAR: ${c.avoid}` : '',
    c.customInstructions ? `INSTRUCCIONES ESPECIALES: ${c.customInstructions}` : '',
    c.goodExample ? `EJEMPLO DE PREGUNTA IDEAL: ${c.goodExample}` : '',
    c.badExample ? `PREGUNTA A EVITAR: ${c.badExample}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const classicRules = c.classicTypes
    .map((t) => CLASSIC_RULES[t.jsonType])
    .filter(Boolean)
    .join('\n');

  const prompt = `Eres un profesor experto generando preguntas de evaluacion.

${header}

CONTENIDO DEL MATERIAL:
${(input.context || '').substring(0, RAG_CONTEXT_CHAR_LIMIT)}

Genera EXACTAMENTE ${total} preguntas, distribuidas asi (respeta la cantidad exacta de cada tipo, no generes solo un tipo):
${typeInstructions}

TIPOS PERMITIDOS: el campo "type" solo puede valer ${requestedTypes.map((t) => `"${t}"`).join(', ')}. No generes ningun otro tipo de pregunta ni de minijuego.

No repitas preguntas ni reformules la misma idea dos veces; cada pregunta debe cubrir un aspecto distinto del tema.
${classicRules || minigames.length > 0 ? '\nREGLAS ADICIONALES POR TIPO:\n' + classicRules : ''}${minigameRulesFor(minigames)}

NOTACION MATEMATICA: si el contenido requiere formulas, ecuaciones o simbolos matematicos (ej: funciones, derivadas, condiciones de optimizacion), escribelos en LaTeX: usa $...$ para notacion inline (ej: $U(x,y) = x^{0.5}y^{0.5}$) y $$...$$ para ecuaciones en bloque. No uses LaTeX si el tema no lo requiere.

${input.conceptBlock || GENERIC_CONCEPT_TAG_BLOCK}

${ANTI_HALLUCINATION_BLOCK}

Responde SOLO con JSON valido:
{"questions":[...${total} preguntas aqui, en el orden y cantidad indicados arriba...]}`;

  return { prompt, total, requestedTypes };
}

// Lineas de configuracion para el repaso dirigido (preguntas cortas de apoyo
// sobre los conceptos donde el estudiante fallo). Ese prompt no usa el
// constructor principal, pero aun asi debe respetar lo que el profesor definio
// para la clase: el grado, el nivel de lenguaje, lo que no quiere que se toque y
// sus instrucciones. Devuelve "" o lineas terminadas en salto de linea, para
// pegarse directamente antes de "CONTENIDO DEL MATERIAL".
export function remediationPreamble(c: ResolvedConfig): string {
  const lines = [
    c.gradeDetail ? `GRADO: ${c.gradeDetail}` : '',
    `NIVEL DE LENGUAJE: ${c.languageLevel}`,
    c.avoid ? `TEMAS A EVITAR: ${c.avoid}` : '',
    c.customInstructions ? `INSTRUCCIONES ESPECIALES: ${c.customInstructions}` : '',
  ].filter(Boolean);
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}
