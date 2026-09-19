// Prompt del "Map Designer" (generate-classroom-map), separado del handler para
// poder probarlo sin Deno ni red: tanto la funcion de Supabase como los tests de
// Vitest lo importan. Sin dependencias, sin APIs de Deno.
//
// Por que existe: la funcion diseñaba los modulos de la clase usando SOLO el
// nombre, la materia, el grado y la descripcion de `classrooms`. La configuracion
// que el profesor escribe en el "Cerebro de la IA" (classroom_ai_config) --
// descripcion de la materia, objetivos de aprendizaje, temas a enfatizar y a
// evitar, nivel de lenguaje, instrucciones -- no llegaba a la creacion de modulos.
// Un profesor podia escribir "no quiero modulos sobre guerras" y la funcion ni lo
// leia.

// Subconjunto de classroom_ai_config que la creacion de modulos tiene en cuenta.
export interface MapConfig {
  subject_description?: string | null;
  grade_level_detail?: string | null;
  learning_objectives?: string | null;
  language_level?: string | null;
  question_depth?: number | null;
  topics_emphasize?: string | null;
  topics_avoid?: string | null;
  custom_instructions?: string | null;
}

// Columnas de classroom_ai_config que SI influyen en el diseño del mapa.
export const MAP_CONFIG_FIELDS = [
  'subject_description',
  'grade_level_detail',
  'learning_objectives',
  'language_level',
  'question_depth',
  'topics_emphasize',
  'topics_avoid',
  'custom_instructions',
] as const;

// Columnas que NO aplican al diseño de modulos, con el motivo. Existe para que
// una columna nueva no quede sin decidir (ver generationConfig.test.ts, que hace
// la misma comprobacion para la generacion de preguntas).
export const MAP_CONFIG_NOT_APPLICABLE: Record<string, string> = {
  skill_memory: 'Se aplica al generar preguntas, no al diseñar modulos.',
  skill_comprehension: 'Se aplica al generar preguntas, no al diseñar modulos.',
  skill_application: 'Se aplica al generar preguntas, no al diseñar modulos.',
  skill_analysis: 'Se aplica al generar preguntas, no al diseñar modulos.',
  skill_synthesis: 'Se aplica al generar preguntas, no al diseñar modulos.',
  skill_evaluation: 'Se aplica al generar preguntas, no al diseñar modulos.',
  type_multiple_choice: 'Tipo de pregunta: se aplica al generar preguntas.',
  type_true_false: 'Tipo de pregunta: se aplica al generar preguntas.',
  type_fill_blank: 'Tipo de pregunta: se aplica al generar preguntas.',
  type_match: 'Tipo de pregunta: se aplica al generar preguntas.',
  type_short_answer: 'Tipo de pregunta: se aplica al generar preguntas.',
  type_order: 'Columna heredada sin efecto en ningun generador.',
  question_style: 'Columna heredada sin efecto en ningun generador.',
  minigame_types: 'Minijuegos: se aplican al generar preguntas, no al diseñar modulos.',
  example_good_question: 'Ejemplo de pregunta: se aplica al generar preguntas.',
  example_bad_question: 'Ejemplo de pregunta: se aplica al generar preguntas.',
};

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Devuelve "" si el profesor no configuro nada relevante, o un bloque terminado
// en salto de linea listo para pegarse en el prompt.
export function buildMapConfigSection(cfg: MapConfig | null | undefined): string {
  if (!cfg) return '';
  const lines: string[] = [];

  const subject = clean(cfg.subject_description);
  const grade = clean(cfg.grade_level_detail);
  const objectives = clean(cfg.learning_objectives);
  const language = clean(cfg.language_level);
  const emphasize = clean(cfg.topics_emphasize);
  const avoid = clean(cfg.topics_avoid);
  const custom = clean(cfg.custom_instructions);

  if (subject) lines.push(`- Descripción de la materia (por el profesor): ${subject}`);
  if (grade) lines.push(`- Nivel y grado (por el profesor): ${grade}`);
  if (objectives) {
    lines.push(
      `- Objetivos de aprendizaje de la clase: ${objectives}\n  (El mapa debe cubrir estos objetivos: cada uno debe quedar atendido por al menos un módulo.)`
    );
  }
  if (emphasize) {
    lines.push(`- Temas a ENFATIZAR: ${emphasize}\n  (Dales módulos propios o más peso en el mapa.)`);
  }
  if (avoid) {
    lines.push(`- Temas a EVITAR: ${avoid}\n  (No crees módulos sobre ellos ni los incluyas como palabras clave.)`);
  }
  if (language) {
    lines.push(`- Nivel de lenguaje: ${language}\n  (Usa ese registro en los títulos y las descripciones.)`);
  }
  if (typeof cfg.question_depth === 'number' && cfg.question_depth > 0) {
    lines.push(
      `- Profundidad deseada: ${cfg.question_depth}/5 (1 = básica, 5 = avanzada). Refléjala en la exigencia de las descripciones.`
    );
  }
  if (custom) lines.push(`- Instrucciones especiales: ${custom}`);

  if (lines.length === 0) return '';
  return `CONFIGURACIÓN DEL PROFESOR PARA ESTA CLASE (tiene prioridad sobre tus supuestos y sobre el material cuando haya conflicto):\n${lines.join('\n')}\n\n`;
}

export interface MapPromptInput {
  classroomName: string;
  subjectArea: string;
  gradeLevel: string;
  description: string;
  topics: string[];
  samples: string;
  config?: MapConfig | null;
}

export function buildMapPrompt(input: MapPromptInput): string {
  return `Eres un diseñador de currículum experto. Tu tarea: diseñar un MAPA DE APRENDIZAJE
para esta clase, dividido en 5-12 módulos secuenciales con dificultad progresiva.

CLASE:
- Nombre: ${input.classroomName}
- Materia: ${input.subjectArea}
- Grado: ${input.gradeLevel}
- Descripción: ${input.description}

${buildMapConfigSection(input.config)}TEMAS DETECTADOS EN EL MATERIAL:
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
}
