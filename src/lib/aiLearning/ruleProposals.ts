// Flechas «rechazos -> reglas» y «retrospectiva aceptada -> regla»: la IA PROPONE reglas para el cuaderno de estilo, siempre como BORRADOR que el profesor activa.
//
// Para reducir errores, la IA NO escribe reglas libres: elige entre PLANTILLAS CURADAS (escritas y revisadas de antemano, con su principio de la doctrina) segun la categoria de error que mas se repite en los
// rechazos reales, y solo si hay evidencia suficiente. Un modelo que inventara reglas podria introducir instrucciones erroneas; una plantilla no.
// IMPORTANTE (honestidad): que una regla este bien fundamentada NO prueba que reduzca errores en ESTE generador; los experimentos A/B del 2026-11 no mostraron efecto medible (la metrica esta en el techo).
// Por eso son propuestas con evidencia visible, nunca activas por si solas.

import { CATEGORIES, classifyReason, isFormValidatorReason, type ErrorCategory } from './errorTaxonomy';
import type { PlaybookRule } from './playbook';

export const MIN_TOTAL_REASONS = 30;
export const MIN_PROPOSAL_COUNT = 8;
export const MIN_PROPOSAL_SHARE = 0.08;
export const MAX_PROPOSALS = 5;

export interface Template {
  text: string;
  /** Principios de la doctrina que respaldan la plantilla. */
  principleIds: string[];
}

/** Plantillas curadas, una por categoria de error ATRIBUIBLE AL GENERADOR. Las categorias de infraestructura o pipeline no tienen plantilla: no se arreglan con reglas de estilo. */
export const TEMPLATES: Partial<Record<ErrorCategory, Template>> = {
  error_conceptual_o_calculo: {
    text: 'Antes de fijar la respuesta correcta, verifícala contra el material; si hay un cálculo, resuélvelo paso a paso y escribe el resultado exacto.',
    principleIds: ['clave_defendible', 'alineacion_objetivo_evaluacion'],
  },
  anclaje_material: {
    text: 'Cada pregunta debe poder responderse solo con lo que dice el material; no introduzcas conceptos, fórmulas ni datos que el material no explique.',
    principleIds: ['alineacion_objetivo_evaluacion', 'clave_defendible'],
  },
  ambiguedad_respuesta_unica: {
    text: 'Deja una sola respuesta correcta; las demás opciones deben ser claramente incorrectas y no verdades parciales.',
    principleIds: ['redaccion_opcion_multiple'],
  },
  no_autocontenida: {
    text: 'Incluye en el enunciado todos los datos, símbolos y condiciones necesarios; la pregunta debe entenderse sin ver el material.',
    principleIds: ['carga_cognitiva', 'redaccion_opcion_multiple'],
  },
  respuesta_no_evaluable: {
    text: 'En respuesta corta y completar, la respuesta esperada debe ser breve (1 a 3 palabras) y verificable; si la respuesta natural es una explicación o una fórmula, usa opción múltiple.',
    principleIds: ['respuesta_corta_verificable'],
  },
  formato_minijuego: {
    text: 'En los minijuegos respeta exactamente el formato y la cantidad de elementos que pide cada uno.',
    principleIds: [],
  },
  redaccion_confusa: {
    text: 'Escribe enunciados cortos y directos, con una sola idea y sin negaciones innecesarias.',
    principleIds: ['carga_cognitiva', 'redaccion_opcion_multiple'],
  },
  duplicada: {
    text: 'No repitas preguntas ni reformules la misma idea: cada pregunta debe cubrir un aspecto distinto del tema.',
    principleIds: ['cobertura_y_dificultad'],
  },
};

export interface RuleProposal {
  category: ErrorCategory;
  count: number;
  /** Fraccion sobre los motivos de rechazo analizados. */
  share: number;
  rule: PlaybookRule;
  principleIds: string[];
}

export interface ProposalResult {
  proposals: RuleProposal[];
  /** Motivos analizados (sin los del validador de forma). */
  total: number;
  /** true = no hay motivos suficientes para proponer nada (no se concluye). */
  insufficient: boolean;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Propone reglas a partir de los motivos de rechazo o revision. Determinista; sin datos suficientes no propone nada. */
export function proposeRules(reasons: (string | null | undefined)[], existing: PlaybookRule[] = []): ProposalResult {
  const counts = new Map<ErrorCategory, number>();
  let total = 0;
  for (const r of reasons) {
    if (isFormValidatorReason(r)) continue;
    total++;
    const c = classifyReason(r);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (total < MIN_TOTAL_REASONS) return { proposals: [], total, insufficient: true };

  const have = new Set(existing.map((r) => r.text.trim().toLowerCase()));
  const proposals: RuleProposal[] = [];
  for (const [category, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const tpl = TEMPLATES[category];
    if (!tpl || CATEGORIES[category].origin !== 'generador') continue;
    const share = count / total;
    if (count < MIN_PROPOSAL_COUNT || share < MIN_PROPOSAL_SHARE) continue;
    if (have.has(tpl.text.trim().toLowerCase())) continue; // la regla ya esta en el cuaderno
    proposals.push({
      category,
      count,
      share,
      principleIds: tpl.principleIds,
      rule: { text: tpl.text, evidence: `${count} de ${total} rechazos o revisiones (${pct(share)}): ${CATEGORIES[category].label}.` },
    });
    if (proposals.length >= MAX_PROPOSALS) break;
  }
  return { proposals, total, insufficient: false };
}

/** Datos minimos de una sugerencia de la retrospectiva. */
export interface SuggestionLike {
  kind: string;
  text: string;
  evidence: string;
  status: string;
}

/**
 * Convierte una sugerencia ACEPTADA en una regla candidata para el cuaderno, solo para los tipos que tienen una traduccion segura. Hoy: reforzar un concepto -> pedir una pregunta de aplicacion
 * sobre ese concepto. El resto (revisar una pregunta, resolver la cola, medir al juez) son tareas para el profesor, no reglas de estilo.
 */
export function ruleFromSuggestion(s: SuggestionLike): PlaybookRule | null {
  if (s.status !== 'accepted' || s.kind !== 'reinforce_concept') return null;
  const tag = s.text.match(/«([^»]{2,60})»/)?.[1]?.trim();
  if (!tag) return null;
  return { text: `Incluye siempre al menos una pregunta que obligue a aplicar el concepto «${tag}» en un caso, porque los estudiantes lo fallan con frecuencia.`, evidence: s.evidence };
}
