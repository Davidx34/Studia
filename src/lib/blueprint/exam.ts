// Componer un EXAMEN (evaluacion de un corte o evaluacion final) a partir de las preguntas de los modulos enlazados. Codigo puro: recibe solo ids y tipos (nunca el contenido ni las
// claves) y devuelve QUE preguntas entran. Con el rng inyectado el resultado es reproducible en las pruebas. Decisiones por defecto (docs/EVALUACIONES.md):
//
//   - Las preguntas salen del banco de los modulos REALES enlazados al corte (no se genera contenido nuevo para el examen).
//   - Solo entran tipos que el servidor ya califica con sus calificadores (multiple_choice, true_false, fill_blank, short_answer, match). Los minijuegos no entran.
//   - Un examen NO se arma si falta cubrir algo: un modulo del corte sin enlace, o enlazado a un modulo sin preguntas calificables, es un hueco que el examen no puede comprobar y
//     NO se salta en silencio (si no, "dominar el corte" no significaria haber comprobado el corte). Se devuelve la razon y los modulos que faltan.
//   - Reparto equitativo por modulo (cada modulo aporta lo mismo, +1 a los primeros si no divide exacto) y, si un modulo tiene menos preguntas que su cupo, el sobrante se reparte entre
//     los demas. La evaluacion final reparte primero entre los cortes segun su peso y luego entre los modulos de cada corte.
//   - Una pregunta entra a lo sumo una vez.

import { planModules, type Link } from './links';
import type { Blueprint } from './types';

export const EXAM_QUESTION_TYPES = ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match'] as const;
export const DEFAULT_PERIOD_EXAM_SIZE = 10;
export const DEFAULT_FINAL_EXAM_SIZE = 20;
export const MIN_EXAM_QUESTIONS = 5;
export const MAX_EXAM_QUESTIONS = 60;

export interface BankQuestion {
  id: string;
  moduleId: string; // el modulo REAL
  type: string;
}

export type ExamKind = { kind: 'period'; periodId: string } | { kind: 'final' };

export type ComposeResult =
  | { ok: true; questionIds: string[]; perModule: Record<string, number> }
  | { ok: false; reason: 'noSuchPeriod' | 'noModules' | 'unlinked' | 'noQuestions' | 'tooFew'; message: string; missing?: { nodeId: string; title: string }[] };

const isGradable = (t: unknown): boolean => typeof t === 'string' && (EXAM_QUESTION_TYPES as readonly string[]).includes(t);

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
  // El resto, de uno en uno: primero a quien tiene mayor parte fraccionaria; si ya nadie puede, a quien aun tenga disponibles.
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

export function composeExam(args: { plan: Blueprint; links: readonly Link[]; bank: readonly BankQuestion[]; exam: ExamKind; size?: number; rng?: () => number }): ComposeResult {
  const { plan, links, bank } = args;
  const rng = args.rng ?? Math.random;
  const size = Math.max(1, Math.min(MAX_EXAM_QUESTIONS, Math.floor(args.size ?? (args.exam.kind === 'final' ? DEFAULT_FINAL_EXAM_SIZE : DEFAULT_PERIOD_EXAM_SIZE))));

  const realOf = new Map(links.map((l) => [l.nodeId, l.moduleId]));
  const periods = plan.periods.slice().sort((a, b) => a.order - b.order);
  const exam = args.exam;
  const target = exam.kind === 'period' ? periods.filter((p) => p.id === exam.periodId) : periods;
  if (exam.kind === 'period' && target.length === 0) return { ok: false, reason: 'noSuchPeriod', message: 'Ese corte no existe en el plan.' };

  // Las preguntas disponibles por modulo real (solo tipos que se califican; sin repetidas).
  const byModule = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const q of bank) {
    if (!q || typeof q.id !== 'string' || typeof q.moduleId !== 'string' || !isGradable(q.type) || seen.has(q.id)) continue;
    seen.add(q.id);
    byModule.set(q.moduleId, [...(byModule.get(q.moduleId) ?? []), q.id]);
  }

  // Los modulos de cada corte, y los huecos que impiden comprobarlo.
  const groups: { weight: number; modules: { nodeId: string; title: string; real: string | null }[] }[] = [];
  for (const p of target) {
    const nodes = planModules({ ...plan, periods: [p] });
    groups.push({ weight: p.weight, modules: nodes.map((n) => ({ nodeId: n.nodeId, title: n.title, real: realOf.get(n.nodeId) ?? null })) });
  }
  const all = groups.flatMap((g) => g.modules);
  if (all.length === 0) return { ok: false, reason: 'noModules', message: 'No hay modulos que evaluar.' };
  const unlinked = all.filter((m) => m.real === null);
  if (unlinked.length > 0) return { ok: false, reason: 'unlinked', message: 'Hay modulos del plan sin contenido enlazado: el examen no los podria comprobar.', missing: unlinked.map((m) => ({ nodeId: m.nodeId, title: m.title })) };
  const empty = all.filter((m) => (byModule.get(m.real!)?.length ?? 0) === 0);
  if (empty.length > 0) return { ok: false, reason: 'noQuestions', message: 'Hay modulos sin preguntas que el servidor pueda calificar: el examen no los podria comprobar.', missing: empty.map((m) => ({ nodeId: m.nodeId, title: m.title })) };

  // Reparto: entre cortes por peso (solo la final tiene mas de uno) y luego entre los modulos de cada corte por igual.
  const capOfGroup = groups.map((g) => g.modules.reduce((s, m) => s + byModule.get(m.real!)!.length, 0));
  const perGroup = allocate(size, capOfGroup, groups.map((g) => g.weight));
  const chosen: string[] = [];
  const taken = new Set<string>();
  const perModule: Record<string, number> = {};
  groups.forEach((g, gi) => {
    const caps = g.modules.map((m) => byModule.get(m.real!)!.length);
    const counts = allocate(perGroup[gi], caps, caps.map(() => 1));
    g.modules.forEach((m, mi) => {
      // Una pregunta entra una sola vez aunque un mismo modulo real estuviera enlazado a dos nodos (la base lo impide; esta funcion no se fia de eso).
      const picked = shuffle(byModule.get(m.real!)!, rng)
        .filter((id) => !taken.has(id))
        .slice(0, counts[mi]);
      for (const id of picked) taken.add(id);
      chosen.push(...picked);
      perModule[m.real!] = (perModule[m.real!] ?? 0) + picked.length;
    });
  });

  if (chosen.length < MIN_EXAM_QUESTIONS) return { ok: false, reason: 'tooFew', message: `Con las preguntas que hay solo se pueden armar ${chosen.length}; el examen necesita al menos ${MIN_EXAM_QUESTIONS}.` };
  return { ok: true, questionIds: shuffle(chosen, rng), perModule };
}
