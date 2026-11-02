// Lo que la pantalla de revision del banco muestra al profesor. Codigo puro: de las filas del banco y el plan sale, por comprension, que preguntas mirar primero y como se lee cada una
// (enunciado, clave, explicacion, material, aviso del juez). La pantalla solo pinta esto.

import type { BankRow, ReviewStatus } from './examBank';
import { planModules } from './links';
import type { Blueprint } from './types';

export interface ReviewItem {
  id: string;
  status: ReviewStatus;
  type: string;
  typeLabel: string;
  q: string;
  // Las opciones (si hay), con la correcta marcada.
  options: { text: string; correct: boolean }[];
  // Resumen de la clave en una linea cuando no hay opciones (verdadero/falso, respuestas, palabras clave, parejas).
  key: string;
  exp: string;
  quote: string;
  materialName: string;
  chunk: number;
  moduleTitle: string;
  periodName: string;
  verdictLabel: string;
  // true = el juez lo dejo sin decidir o no lo juzgo: el profesor debe mirarlo con atencion.
  attention: boolean;
  problems: string[];
}

export interface ReviewGroup {
  outcomeId: string;
  statement: string;
  approved: number;
  pending: number;
  rejected: number;
  items: ReviewItem[];
}

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: 'Opcion multiple',
  true_false: 'Verdadero o falso',
  fill_blank: 'Completar',
  short_answer: 'Respuesta corta',
  match: 'Emparejar',
};

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function keyOf(r: BankRow): { options: ReviewItem['options']; key: string } {
  const opts = asStrings(r.opts);
  if (r.type === 'multiple_choice' && opts.length > 0) {
    const ok = typeof r.ok === 'number' ? r.ok : -1;
    return { options: opts.map((text, i) => ({ text, correct: i === ok })), key: '' };
  }
  if (r.type === 'true_false') return { options: [], key: r.ok === true ? 'Verdadero' : r.ok === false ? 'Falso' : '' };
  if (r.type === 'fill_blank') return { options: [], key: `Respuestas aceptadas: ${asStrings(r.answers).join(' · ')}` };
  if (r.type === 'short_answer') return { options: [], key: `Palabras clave: ${asStrings(r.keywords).join(' · ')}` };
  if (r.type === 'match' && Array.isArray(r.pairs)) {
    const pairs = (r.pairs as unknown[]).flatMap((p) => (p && typeof p === 'object' && typeof (p as any).term === 'string' && typeof (p as any).def === 'string' ? [`${(p as any).term} → ${(p as any).def}`] : []));
    return { options: [], key: pairs.join('  |  ') };
  }
  return { options: [], key: '' };
}

const verdictLabel = (v: BankRow['judge_verdict']): string => (v === 'supported' ? 'El juez la respalda' : v === 'unclear' ? 'El juez no pudo decidir: revisala con atencion' : v === 'not_judged' ? 'No pasó por el juez: revisala con atencion' : 'El juez la rechazó');

// Orden dentro de una comprension: primero lo pendiente que pide atencion, luego el resto de lo pendiente, luego lo decidido.
const rank = (i: ReviewItem): number => (i.status === 'pending' ? (i.attention ? 0 : 1) : i.status === 'approved' ? 2 : 3);

export function buildReview(plan: Blueprint, rows: readonly BankRow[], materialNames: ReadonlyMap<string, string>): ReviewGroup[] {
  const mod = new Map(planModules(plan).map((m) => [m.nodeId, m]));
  return plan.outcomes.map((o): ReviewGroup => {
    const mine = rows.filter((r) => r.outcome_id === o.id);
    const items = mine.map((r): ReviewItem => {
      const k = keyOf(r);
      const m = mod.get(r.node_id);
      return {
        id: r.id,
        status: r.review_status,
        type: r.type,
        typeLabel: TYPE_LABEL[r.type] ?? r.type,
        q: r.q,
        options: k.options,
        key: k.key,
        exp: r.exp,
        quote: r.source_quote,
        materialName: materialNames.get(r.source_material_id) ?? 'Material de la clase',
        chunk: r.source_chunk,
        moduleTitle: m?.title ?? '(modulo que ya no esta en el plan)',
        periodName: m?.periodName ?? '',
        verdictLabel: verdictLabel(r.judge_verdict),
        attention: r.judge_verdict !== 'supported',
        problems: asStrings(r.judge_problems),
      };
    });
    items.sort((a, b) => rank(a) - rank(b));
    return {
      outcomeId: o.id,
      statement: o.statement,
      approved: mine.filter((r) => r.review_status === 'approved').length,
      pending: mine.filter((r) => r.review_status === 'pending').length,
      rejected: mine.filter((r) => r.review_status === 'rejected').length,
      items,
    };
  });
}
