// Componer un EXAMEN (evaluacion de un corte o evaluacion final) a partir del banco de PREGUNTAS DE EXAMEN del plan (decision 1B: preguntas propias, escritas por la IA para medir cada
// comprension final; ver examQuestion.ts). Codigo puro: recibe solo ids (nunca el contenido ni las claves) y devuelve QUE preguntas entran. Con el rng inyectado es reproducible.
//
//   - La evaluacion de un CORTE mide las comprensiones que ese corte evalua, con preguntas de los modulos de ESE corte. La FINAL mide TODAS las comprensiones del plan.
//   - Un examen NO se arma si alguna comprension que debe medir no tiene ninguna pregunta: el examen no puede comprobarla y NO se salta en silencio (si no, "dominar el corte" no
//     significaria haberlo comprobado). Se devuelve la razon y cuales comprensiones faltan.
//   - Cada comprension aporta lo mismo (+1 a las primeras si no divide exacto) y, dentro de una comprension, las preguntas se reparten entre los modulos donde se vio, para no
//     preguntar siempre del mismo. Si una comprension tiene menos preguntas que su cupo, el sobrante lo ponen las demas.
//   - El tamano nunca baja de una pregunta por comprension (si hay mas comprensiones que preguntas pedidas, se sube el tamano hasta cubrirlas) ni sube de MAX_EXAM_QUESTIONS.
//   - Una pregunta entra a lo sumo una vez.

import { EXAM_TYPES } from './examQuestion';
import type { Blueprint } from './types';

export const DEFAULT_PERIOD_EXAM_SIZE = 10;
export const DEFAULT_FINAL_EXAM_SIZE = 20;
export const MIN_EXAM_QUESTIONS = 5;
export const MAX_EXAM_QUESTIONS = 60;

// Lo unico que el compositor ve de una pregunta del banco.
export interface PoolQuestion {
  id: string;
  outcomeId: string;
  nodeId: string; // el modulo del PLAN donde se vio
  type: string;
}

export type ExamKind = { kind: 'period'; periodId: string } | { kind: 'final' };

export type ComposeResult =
  | { ok: true; questionIds: string[]; perOutcome: Record<string, number>; perModule: Record<string, number> }
  | { ok: false; reason: 'noSuchPeriod' | 'noOutcomes' | 'uncoveredOutcomes' | 'tooFew'; message: string; missing?: { outcomeId: string; statement: string }[] };

export function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Reparte `total` entre grupos con `cap[i]` preguntas disponibles y un peso `w[i]`: primero lo proporcional (redondeo hacia abajo), luego el resto de uno en uno a quien aun tenga
// disponibles (por mayor resto y, a igualdad, por orden), y nadie recibe mas de lo que tiene. Si en total no alcanza, se reparte todo lo que hay.
export function allocate(total: number, cap: readonly number[], w: readonly number[]): number[] {
  const n = cap.length;
  const out = new Array<number>(n).fill(0);
  const sumW = w.reduce((s, x) => s + (x > 0 ? x : 0), 0);
  if (n === 0 || total <= 0) return out;
  const weights = sumW > 0 ? w.map((x) => (x > 0 ? x : 0)) : w.map(() => 1);
  const sum = weights.reduce((s, x) => s + x, 0);
  let left = Math.min(total, cap.reduce((s, x) => s + x, 0));
  const ideal = weights.map((x) => (x / sum) * left);
  for (let i = 0; i < n; i++) {
    out[i] = Math.min(cap[i], Math.floor(ideal[i]));
    left -= out[i];
  }
  while (left > 0) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (out[i] >= cap[i]) continue;
      if (best === -1 || ideal[i] - Math.floor(ideal[i]) > ideal[best] - Math.floor(ideal[best]) + 1e-12) best = i;
    }
    if (best === -1) break;
    out[best]++;
    // Una vez recibido un punto extra, su parte fraccionaria "se gasta" (no vuelve a ganar antes que los demas).
    ideal[best] = Math.floor(ideal[best]);
    left--;
  }
  return out;
}

// Toma `n` elementos repartiendolos entre las listas "de uno en uno" (una de cada modulo por vuelta), con el orden de las listas y el de cada una al azar.
function roundRobin<T>(lists: readonly (readonly T[])[], n: number, rng: () => number): T[] {
  const queues = shuffle(lists, rng).map((l) => shuffle(l, rng));
  const out: T[] = [];
  while (out.length < n) {
    let took = false;
    for (const q of queues) {
      if (out.length >= n) break;
      const x = q.shift();
      if (x !== undefined) {
        out.push(x);
        took = true;
      }
    }
    if (!took) break;
  }
  return out;
}

const isGradable = (t: unknown): boolean => typeof t === 'string' && (EXAM_TYPES as readonly string[]).includes(t);

export function composeExam(args: { plan: Blueprint; pool: readonly PoolQuestion[]; exam: ExamKind; size?: number; rng?: () => number }): ComposeResult {
  const { plan, pool } = args;
  const rng = args.rng ?? Math.random;
  const exam = args.exam;
  const periods = plan.periods.slice().sort((a, b) => a.order - b.order);
  const scope = exam.kind === 'period' ? periods.filter((p) => p.id === exam.periodId) : periods;
  if (exam.kind === 'period' && scope.length === 0) return { ok: false, reason: 'noSuchPeriod', message: 'Ese corte no existe en el plan.' };

  // Que comprensiones mide y en que modulos se pueden haber visto.
  const outcomeIds = exam.kind === 'period' ? scope[0].assessesOutcomeIds : plan.outcomes.map((o) => o.id);
  const outcomes = outcomeIds.map((id) => plan.outcomes.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o);
  if (outcomes.length === 0) return { ok: false, reason: 'noOutcomes', message: 'No hay comprensiones finales que evaluar.' };
  const nodesInScope = new Set(scope.flatMap((p) => p.objectives.flatMap((ob) => ob.modules.map((m) => m.id))));

  // Las preguntas candidatas por comprension (de un modulo del alcance, tipo calificable, sin repetidas).
  const seen = new Set<string>();
  const byOutcome = new Map<string, Map<string, string[]>>(outcomes.map((o) => [o.id, new Map()]));
  for (const q of pool) {
    if (!q || typeof q.id !== 'string' || typeof q.outcomeId !== 'string' || typeof q.nodeId !== 'string' || !isGradable(q.type) || seen.has(q.id)) continue;
    const mods = byOutcome.get(q.outcomeId);
    if (!mods || !nodesInScope.has(q.nodeId)) continue;
    seen.add(q.id);
    mods.set(q.nodeId, [...(mods.get(q.nodeId) ?? []), q.id]);
  }

  const missing = outcomes.filter((o) => byOutcome.get(o.id)!.size === 0);
  if (missing.length > 0) {
    return { ok: false, reason: 'uncoveredOutcomes', message: 'Hay comprensiones finales sin ninguna pregunta: el examen no podria comprobarlas.', missing: missing.map((o) => ({ outcomeId: o.id, statement: o.statement })) };
  }

  const wanted = Math.floor(args.size ?? (exam.kind === 'final' ? DEFAULT_FINAL_EXAM_SIZE : DEFAULT_PERIOD_EXAM_SIZE));
  const size = Math.min(MAX_EXAM_QUESTIONS, Math.max(1, wanted, outcomes.length));
  const caps = outcomes.map((o) => Array.from(byOutcome.get(o.id)!.values()).reduce((s, l) => s + l.length, 0));
  const counts = allocate(size, caps, caps.map(() => 1));

  const chosen: string[] = [];
  const perOutcome: Record<string, number> = {};
  const perModule: Record<string, number> = {};
  const nodeOf = new Map<string, string>();
  for (const q of pool) if (q && typeof q.id === 'string') nodeOf.set(q.id, q.nodeId);
  outcomes.forEach((o, i) => {
    const picked = roundRobin(Array.from(byOutcome.get(o.id)!.values()), counts[i], rng);
    chosen.push(...picked);
    perOutcome[o.id] = picked.length;
    for (const id of picked) perModule[nodeOf.get(id)!] = (perModule[nodeOf.get(id)!] ?? 0) + 1;
  });

  if (chosen.length < MIN_EXAM_QUESTIONS) return { ok: false, reason: 'tooFew', message: `Con las preguntas que hay solo se pueden armar ${chosen.length}; el examen necesita al menos ${MIN_EXAM_QUESTIONS}.` };
  return { ok: true, questionIds: shuffle(chosen, rng), perOutcome, perModule };
}
