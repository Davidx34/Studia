// Conjuntos de reglas CANDIDATAS para medir (arnes A/B: scripts/ab-generation.ts). Una regla solo pasa a un cuaderno real si la medicion dice «mejora» (ver proportion.ts).
// Cada regla apunta a una categoria de error de la linea base (errorTaxonomy.ts) y cita su fundamento; el fundamento NO prueba que funcione con ESTE generador: eso lo decide el experimento.

import type { ErrorCategory } from './errorTaxonomy';
import type { PlaybookRule } from './playbook';

export interface CandidateRule extends PlaybookRule {
  targets: ErrorCategory;
  /** Fundamento en la literatura de redaccion de items de evaluacion (resumen propio, no cita textual). */
  basis: string;
}

export const RULE_SETS: Record<string, CandidateRule[]> = {
  // Orientado a los 5 errores mas frecuentes de la linea base 2026-11-09 (generador: 209 de 304 motivos).
  item_writing_v1: [
    {
      targets: 'error_conceptual_o_calculo',
      text: 'Antes de fijar la respuesta correcta, verifícala contra el material; si hay un cálculo, resuélvelo paso a paso y escribe el resultado exacto.',
      basis: 'Consistente con las guías de redacción de ítems: la clave debe poder defenderse con la fuente (ver Haladyna, Downing y Rodriguez, 2002).',
    },
    {
      targets: 'anclaje_material',
      text: 'Cada pregunta debe poder responderse solo con lo que dice el material; no introduzcas conceptos, fórmulas ni datos que el material no explique.',
      basis: 'Alineación entre lo enseñado y lo evaluado (diseño hacia atrás: Wiggins y McTighe; taxonomía revisada: Anderson y Krathwohl, 2001).',
    },
    {
      targets: 'ambiguedad_respuesta_unica',
      text: 'Deja una sola respuesta correcta; las demás opciones deben ser claramente incorrectas y no verdades parciales.',
      basis: 'Una sola opción correcta, con opciones incorrectas plausibles pero inequívocas (ver Haladyna et al., 2002).',
    },
    {
      targets: 'no_autocontenida',
      text: 'Incluye en el enunciado todos los datos, símbolos y condiciones necesarios; la pregunta debe entenderse sin ver el material.',
      basis: 'El enunciado debe plantear el problema completo, sin depender de contexto oculto (ver Haladyna et al., 2002).',
    },
    {
      targets: 'respuesta_no_evaluable',
      text: 'En respuesta corta y completar, la respuesta esperada debe ser breve (1 a 3 palabras) y verificable; si la respuesta natural es una explicación o una fórmula, usa opción múltiple.',
      basis: 'Respuestas breves y verificables se califican de forma más objetiva (criterio general de desarrollo de pruebas; ver Downing y Haladyna, 2006).',
    },
  ],
  // Nacido de la revision EXTERNA de 79 preguntas (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §13, ronda 2026-11-11): cada regla ataca un defecto observado, con el conteo en «basis». Se mide en una ronda NUEVA
  // (preguntas que no inspiraron las reglas); hasta que diga «mejora» no entra a ningun cuaderno.
  item_writing_v2: [
    {
      targets: 'respuesta_no_evaluable',
      text: 'En completar, pide UNA respuesta por hueco y de una sola forma natural; si el concepto tiene dos nombres válidos, ancla el nombre con «según el material».',
      basis: 'Evidencia propia: 7 defectos en la ronda (respuestas aceptadas que dejaban mal a quien contestaba bien). El calificador exige todas las respuestas de la lista.',
    },
    {
      targets: 'respuesta_no_evaluable',
      text: 'Si el enunciado pide «dos» o «tres» elementos en respuesta corta, usa exactamente esa cantidad de palabras clave.',
      basis: 'Evidencia propia: 1 defecto en la ronda y 4 preguntas del banco servido. El calificador exige todas las palabras clave.',
    },
    {
      targets: 'no_autocontenida',
      text: 'No uses etiquetas de una gráfica o figura que el estudiante no ve («cesta A», «punto B», «la figura»); describe el objeto con palabras.',
      basis: 'Evidencia propia: 3 defectos en la ronda (términos de emparejar y enunciados que dependían de una gráfica).',
    },
    {
      targets: 'redaccion_confusa',
      text: 'No copies del material frases que no se entienden fuera de contexto o que parecen un error de extracción (por ejemplo «(excepto negativos)»); reformúlalas con claridad.',
      basis: 'Evidencia propia: 2 defectos en la ronda; el patrón se repitió en el banco servido.',
    },
    {
      targets: 'ambiguedad_respuesta_unica',
      text: 'En emparejar, cada definición debe distinguir a un único término; no uses dos definiciones equivalentes (por ejemplo, dos nombres del mismo concepto).',
      basis: 'Evidencia propia: 2 defectos en la ronda.',
    },
    {
      targets: 'redaccion_confusa',
      text: 'Enuncia los supuestos que necesita la conclusión («con preferencias monótonas»), y si hablas de una pendiente negativa o de una elasticidad, pregunta por su valor absoluto.',
      basis: 'Evidencia propia: 4 defectos en la ronda (conclusiones que dependían de un supuesto no dicho o de un signo).',
    },
    {
      targets: 'error_conceptual_o_calculo',
      text: 'Revisa que la explicación sea coherente con la respuesta marcada: no puede contradecirla ni traer fórmulas con errores.',
      basis: 'Evidencia propia: 2 defectos críticos en la ronda (explicación que contradecía la clave).',
    },
    {
      targets: 'ambiguedad_respuesta_unica',
      text: 'En verdadero/falso evita absolutos («ninguna», «siempre», «nunca») que delatan la respuesta sin conocer el tema.',
      basis: 'Evidencia propia: 2 defectos menores en la ronda (afirmaciones triviales).',
    },
  ],
};

export const ruleSetNames = (): string[] => Object.keys(RULE_SETS);

/** Reglas listas para el cuaderno (sin los campos del experimento). */
export function toPlaybookRules(name: string): PlaybookRule[] {
  const set = RULE_SETS[name];
  if (!set) throw new Error(`Conjunto de reglas desconocido: ${name}`);
  return set.map(({ text }) => ({ text }));
}
