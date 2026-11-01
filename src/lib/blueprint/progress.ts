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

// ───────────────────────────── evaluaciones: se repiten hasta llegar al 100 % ─────────────────────────────
//
// Decision del dueño: la evaluacion de un corte (y la final) se puede REPETIR, y su nota es el PROMEDIO de todos los intentos hasta llegar al 100 %, igual que un modulo
// (60, 80, 100 -> 80). Cuando un intento llega al 100 % ya no se repite.

export const examScore = moduleScore;
export const examMastered = hasMastered;
export const canRetakeExam = (attempts: readonly number[] | undefined): boolean => !hasMastered(attempts);

// ───────────────────────────── nota de un corte: 70 % modulos + 30 % evaluacion ─────────────────────────────
//
// Decision del dueño: la nota de un corte es 70 % de sus MODULOS y 30 % de su EVALUACION, y las dos notas se muestran por separado. La nota se va COMPUTANDO: cada corte vale 100 puntos
// (hasta 70 por los modulos, hasta 30 por la evaluacion) y lo que todavia no se califico no cuenta como un cero malo, simplemente aun no suma. Asi el estudiante ve su nota subir a
// medida que avanza, y el "promedio sobre lo ya calificado" no se hunde por lo que aun no hizo.
//   - los 70 puntos de los modulos se reparten por igual entre los modulos del corte: cada modulo intentado aporta 70/N * (su nota / 100), con su nota = promedio de sus intentos;
//   - la evaluacion aporta 30 * (su nota / 100) en cuanto tiene un intento, con su nota = promedio de sus intentos.

export const PERIOD_MODULES_POINTS = 70;
export const PERIOD_EXAM_POINTS = 30;

export interface PeriodResult {
  // Promedio de las notas de los modulos ya intentados (0-100); null si ninguno.
  modulesAverage: number | null;
  modulesDone: number; // con al menos un intento
  modulesMastered: number; // con un intento al 100 %
  modulesTotal: number;
  // Nota de la evaluacion del corte (promedio de sus intentos, 0-100); null si todavia no la tomo.
  exam: number | null;
  examAttempts: number;
  // Puntos ganados en el corte, sobre 100 (hasta 70 por los modulos y hasta 30 por la evaluacion).
  points: number;
  // Cuanto del corte ya tiene nota (0-100): 70 * modulos intentados / total + 30 si ya hay evaluacion.
  gradedShare: number;
  // Promedio sobre lo ya calificado (points / gradedShare * 100); null si todavia nada.
  score: number | null;
  // Todo tiene nota: todos los modulos intentados y la evaluacion tomada (la nota todavia puede subir si algo se repite).
  graded: boolean;
  // No queda nada por hacer: todos los modulos y la evaluacion llegaron al 100 % en algun intento.
  closed: boolean;
}

export interface PeriodInput {
  // Los intentos de cada modulo del corte (una entrada por modulo; vacia o undefined si no tiene).
  modules: readonly (readonly number[] | undefined)[];
  // Los intentos de la evaluacion del corte.
  exam?: readonly number[] | undefined;
}

export function periodResult(input: PeriodInput): PeriodResult {
  const total = input.modules.length;
  const scores = input.modules.map((a) => moduleScore(a));
  const done = scores.filter((x): x is number => x !== null);
  const sum = done.reduce((a, b) => a + b, 0);
  const mastered = input.modules.filter((a) => hasMastered(a)).length;
  const exam = examScore(input.exam);

  const modulePoints = total > 0 ? (PERIOD_MODULES_POINTS * sum) / 100 / total : 0;
  const moduleShare = total > 0 ? (PERIOD_MODULES_POINTS * done.length) / total : 0;
  const examPoints = exam !== null ? (PERIOD_EXAM_POINTS * exam) / 100 : 0;
  const examShare = exam !== null ? PERIOD_EXAM_POINTS : 0;

  const points = round2(modulePoints + examPoints);
  const gradedShare = round2(moduleShare + examShare);
  return {
    modulesAverage: done.length > 0 ? round2(sum / done.length) : null,
    modulesDone: done.length,
    modulesMastered: mastered,
    modulesTotal: total,
    exam,
    examAttempts: clean(input.exam).length,
    points,
    gradedShare,
    score: gradedShare > 0 ? round2((points / gradedShare) * 100) : null,
    graded: total > 0 && done.length === total && exam !== null,
    closed: total > 0 && mastered === total && examMastered(input.exam),
  };
}

// El resultado de un corte del plan a partir de los intentos de sus modulos y los de su evaluacion.
export function periodResultOf(period: Period, attempts: Attempts, examAttempts?: readonly number[]): PeriodResult {
  const modules: (readonly number[] | undefined)[] = [];
  for (const o of period.objectives) for (const m of o.modules) modules.push(attempts.get(m.id));
  return periodResult({ modules, exam: examAttempts });
}

// ───────────────────────────── evaluacion final: medio corte ─────────────────────────────
//
// Decision del dueño: la evaluacion final tiene nota propia y vale MEDIO corte. Con 3 cortes y el examen final son 3,5 cortes que se promedian para la nota del curso. Como los cortes
// llevan ponderacion, "medio corte" es la MITAD del peso promedio de un corte (con cortes iguales es exactamente 1/3,5 del curso).

export const FINAL_EXAM_FACTOR = 0.5;

export interface FinalExamResult {
  // Nota (promedio de sus intentos, 0-100); null si todavia no la tomo.
  score: number | null;
  attempts: number;
  points: number;
  gradedShare: number; // 0 sin intentos, 100 con alguno
  closed: boolean; // llego al 100 %
  canRetake: boolean;
}

export function finalExamResult(attempts: readonly number[] | undefined): FinalExamResult {
  const score = examScore(attempts);
  return { score, attempts: clean(attempts).length, points: score ?? 0, gradedShare: score === null ? 0 : 100, closed: examMastered(attempts), canRetake: canRetakeExam(attempts) };
}

// Peso de la evaluacion final: la mitad del peso promedio de un corte.
export function finalExamWeight(periods: readonly { weight: number }[]): number {
  const w = periods.map((p) => p.weight).filter((x) => Number.isFinite(x) && x > 0);
  return w.length > 0 ? (FINAL_EXAM_FACTOR * w.reduce((a, b) => a + b, 0)) / w.length : 0;
}

export interface CourseGrade {
  // Puntos del curso ya ganados sobre 100: suma ponderada de los cortes y la evaluacion final, entre el peso total (cortes + final).
  earned: number;
  // Cuanto del curso ya tiene nota (0-100).
  completedWeight: number;
  // Promedio sobre lo ya calificado (0-100); null si todavia no hay nada.
  average: number | null;
  // Todo tiene nota (todos los cortes y la evaluacion final): `earned` es la nota del curso. Puede subir todavia si algo se repite.
  graded: boolean;
}

// Nota del curso: los cortes (cada uno por su ponderacion) mas la evaluacion final (medio corte), promediados y computados a medida que se califica. Un resultado imposible (puntos fuera
// de 0-100, o mas puntos que lo calificado) se ignora. La evaluacion final cuenta en el peso total aunque aun no se haya tomado: la nota es "sobre el curso completo".
export function courseGrade(
  periods: readonly { id: string; weight: number }[],
  results: ReadonlyMap<string, Pick<PeriodResult, 'points' | 'gradedShare'>>,
  finalExam?: Pick<PeriodResult, 'points' | 'gradedShare'> | null
): CourseGrade {
  const usable = (r: Pick<PeriodResult, 'points' | 'gradedShare'> | null | undefined): r is Pick<PeriodResult, 'points' | 'gradedShare'> =>
    !!r && validScore(r.points) && validScore(r.gradedShare) && r.points <= r.gradedShare + 1e-9;

  const finalWeight = finalExamWeight(periods);
  let total = finalWeight;
  let earned = 0;
  let done = 0;
  let all = periods.length > 0;
  for (const p of periods) {
    if (p.weight > 0) total += p.weight;
    const r = results.get(p.id);
    if (usable(r) && p.weight > 0) {
      earned += (p.weight * r.points) / 100;
      done += (p.weight * r.gradedShare) / 100;
      if (r.gradedShare < 100) all = false;
    } else all = false;
  }
  if (usable(finalExam) && finalWeight > 0) {
    earned += (finalWeight * finalExam.points) / 100;
    done += (finalWeight * finalExam.gradedShare) / 100;
    if (finalExam.gradedShare < 100) all = false;
  } else all = false;

  if (total <= 0) return { earned: 0, completedWeight: 0, average: null, graded: false };
  return { earned: round2((earned / total) * 100), completedWeight: round2((done / total) * 100), average: done > 0 ? round2((earned / done) * 100) : null, graded: all };
}
