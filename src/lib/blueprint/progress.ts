// Cuentas de avance y notas del plan. Reglas del dueño:
//   - AVANCE POR DOMINIO: el estudiante no pasa al siguiente modulo mientras no logre 100 % en el actual (en UN intento).
//   - CADA INTENTO CUENTA: la nota del modulo es el PROMEDIO de todos sus intentos (80, 90, 100 -> sigue, y el modulo queda en 90).
//   - Los cortes pesan por porcentaje y la nota del curso es la suma ponderada.
//
// Codigo puro: recibe los puntajes (0-100) ya calificados en el servidor; no califica nada. Se usan Map (no objetos sueltos): un id como "__proto__" es un id valido.

import type { Blueprint, Period } from './types';

export const MASTERY_PERCENT = 100;

export type Attempts = ReadonlyMap<string, readonly number[]>;

const validScore = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

// Los puntajes validos (se ignora lo que no sea un numero entre 0 y 100: un dato corrupto no debe subir ni bajar una nota en silencio).
function clean(attempts: readonly number[] | undefined): number[] {
  return (attempts ?? []).filter(validScore);
}

// Nota de un modulo = promedio de TODOS sus intentos. null si todavia no hay ninguno.
export function moduleScore(attempts: readonly number[] | undefined): number | null {
  const a = clean(attempts);
  if (a.length === 0) return null;
  return round2(a.reduce((s, x) => s + x, 0) / a.length);
}

// ¿Logro el 100 % en algun intento? (lo que desbloquea el siguiente modulo)
export function hasMastered(attempts: readonly number[] | undefined): boolean {
  return clean(attempts).some((x) => x >= MASTERY_PERCENT);
}

export interface FlatModule {
  moduleId: string;
  objectiveId: string;
  periodId: string;
}

// Los modulos en el orden en que el estudiante los recorre: cortes por orden, objetivos como estan en el plan, modulos por orden.
export function flattenModules(bp: Blueprint): FlatModule[] {
  const out: FlatModule[] = [];
  const periods = bp.periods.slice().sort((a, b) => a.order - b.order);
  for (const p of periods) {
    for (const o of p.objectives) {
      for (const m of o.modules.slice().sort((a, b) => a.order - b.order)) out.push({ moduleId: m.id, objectiveId: o.id, periodId: p.id });
    }
  }
  return out;
}

export interface Unlocked {
  // Modulos que el estudiante puede abrir ahora: los que ya domino, mas el primero que le falta.
  available: Set<string>;
  // El primero que le falta dominar (null si termino todo).
  next: string | null;
  mastered: Set<string>;
}

export function unlockedModules(bp: Blueprint, attempts: Attempts): Unlocked {
  const available = new Set<string>();
  const mastered = new Set<string>();
  let next: string | null = null;
  for (const m of flattenModules(bp)) {
    if (next !== null) break; // todo lo que sigue al primero sin dominar esta bloqueado
    available.add(m.moduleId);
    if (hasMastered(attempts.get(m.moduleId))) mastered.add(m.moduleId);
    else next = m.moduleId;
  }
  return { available, next, mastered };
}

// ───────────────────────────── nota de un corte: 70 % modulos + 30 % evaluacion ─────────────────────────────
//
// Decision del dueño: la nota de un corte es 70 % de sus MODULOS y 30 % de su EVALUACION, y las dos notas se muestran por separado. La nota se va COMPUTANDO: cada corte vale 100 puntos
// (hasta 70 por los modulos, hasta 30 por la evaluacion) y lo que todavia no se califico no cuenta como un cero malo, simplemente aun no suma. Asi el estudiante ve su nota subir a
// medida que avanza, y el "promedio sobre lo ya calificado" no se hunde por lo que aun no hizo.
//   - los 70 puntos de los modulos se reparten por igual entre los modulos del corte: cada modulo intentado aporta 70/N * (su nota / 100);
//   - la evaluacion aporta 30 * (su nota / 100) en cuanto existe.

export const PERIOD_MODULES_POINTS = 70;
export const PERIOD_EXAM_POINTS = 30;

export interface PeriodResult {
  // Promedio de las notas de los modulos ya intentados (0-100); null si ninguno.
  modulesAverage: number | null;
  modulesDone: number;
  modulesTotal: number;
  // Nota de la evaluacion del corte (0-100); null si todavia no la tomo.
  exam: number | null;
  // Puntos ganados en el corte, sobre 100 (hasta 70 por los modulos y hasta 30 por la evaluacion).
  points: number;
  // Cuanto del corte ya tiene nota (0-100): 70 * modulos intentados / total + 30 si ya hay evaluacion.
  gradedShare: number;
  // Promedio sobre lo ya calificado (points / gradedShare * 100); null si todavia nada.
  score: number | null;
  // Todos los modulos intentados y la evaluacion tomada: la nota del corte es `points`.
  complete: boolean;
}

export function periodResult(input: { moduleScores: readonly number[]; totalModules: number; exam?: number | null }): PeriodResult {
  const total = Number.isInteger(input.totalModules) && input.totalModules > 0 ? input.totalModules : 0;
  const used = total > 0 ? clean(input.moduleScores).slice(0, total) : [];
  const sum = used.reduce((a, b) => a + b, 0);
  const hasExam = validScore(input.exam);
  const examScore = hasExam ? (input.exam as number) : null;

  const modulePoints = total > 0 ? (PERIOD_MODULES_POINTS * sum) / 100 / total : 0;
  const moduleShare = total > 0 ? (PERIOD_MODULES_POINTS * used.length) / total : 0;
  const examPoints = examScore !== null ? (PERIOD_EXAM_POINTS * examScore) / 100 : 0;
  const examShare = examScore !== null ? PERIOD_EXAM_POINTS : 0;

  const points = round2(modulePoints + examPoints);
  const gradedShare = round2(moduleShare + examShare);
  return {
    modulesAverage: used.length > 0 ? round2(sum / used.length) : null,
    modulesDone: used.length,
    modulesTotal: total,
    exam: examScore,
    points,
    gradedShare,
    score: gradedShare > 0 ? round2((points / gradedShare) * 100) : null,
    complete: total > 0 && used.length === total && examScore !== null,
  };
}

// El resultado de un corte del plan a partir de los intentos de sus modulos y la nota de su evaluacion.
export function periodResultOf(period: Period, attempts: Attempts, exam?: number | null): PeriodResult {
  const scores: number[] = [];
  let total = 0;
  for (const o of period.objectives) {
    for (const m of o.modules) {
      total++;
      const s = moduleScore(attempts.get(m.id));
      if (s !== null) scores.push(s);
    }
  }
  return periodResult({ moduleScores: scores, totalModules: total, exam });
}

export interface CourseGrade {
  // Puntos ya ganados sobre 100 (suma de peso del corte * puntos del corte / 100).
  earned: number;
  // Cuanto del curso ya tiene nota (0-100): suma de peso del corte * parte ya calificada del corte / 100.
  completedWeight: number;
  // Promedio sobre lo ya calificado (0-100); null si todavia no hay nada.
  average: number | null;
  // Todos los cortes completos: `earned` es la nota final del curso.
  complete: boolean;
}

// Nota del curso: la suma ponderada de los cortes, computada a medida que se califica. Un resultado imposible (puntos fuera de 0-100, o mas puntos que lo calificado) se ignora.
export function courseGrade(periods: readonly { id: string; weight: number }[], results: ReadonlyMap<string, Pick<PeriodResult, 'points' | 'gradedShare'>>): CourseGrade {
  let earned = 0;
  let done = 0;
  let all = periods.length > 0;
  for (const p of periods) {
    const r = results.get(p.id);
    const ok = !!r && validScore(r.points) && validScore(r.gradedShare) && r.points <= r.gradedShare + 1e-9 && p.weight > 0;
    if (ok) {
      earned += (p.weight * r!.points) / 100;
      done += (p.weight * r!.gradedShare) / 100;
      if (r!.gradedShare < 100) all = false;
    } else all = false;
  }
  return { earned: round2(earned), completedWeight: round2(done), average: done > 0 ? round2((earned / done) * 100) : null, complete: all };
}
