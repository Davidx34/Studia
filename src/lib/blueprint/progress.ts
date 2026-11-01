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

// Nota de un corte por sus modulos = promedio de las notas de sus modulos. null si a algun modulo todavia le falta algun intento (no hay nota que mostrar aun).
export function periodModuleAverage(period: Period, attempts: Attempts): number | null {
  const scores: number[] = [];
  for (const o of period.objectives) {
    for (const m of o.modules) {
      const s = moduleScore(attempts.get(m.id));
      if (s === null) return null;
      scores.push(s);
    }
  }
  if (scores.length === 0) return null;
  return round2(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export interface CourseGrade {
  // Puntos ya ganados sobre 100 (suma de peso * nota / 100 de los cortes con nota).
  earned: number;
  // Cuanto del curso ya tiene nota (suma de los pesos de esos cortes, de 0 a 100).
  completedWeight: number;
  // Promedio sobre lo ya calificado (0-100); null si todavia no hay ninguno.
  average: number | null;
  complete: boolean;
}

// Nota del curso a partir de la nota de cada corte (la fuente de la nota de un corte —modulos, evaluacion o ambos— la decide quien llama).
export function courseGrade(periods: readonly { id: string; weight: number }[], scores: ReadonlyMap<string, number | null>): CourseGrade {
  let earned = 0;
  let done = 0;
  let all = true;
  for (const p of periods) {
    const s = scores.get(p.id);
    if (typeof s === 'number' && validScore(s) && p.weight > 0) {
      earned += (p.weight * s) / 100;
      done += p.weight;
    } else all = false;
  }
  return { earned: round2(earned), completedWeight: round2(done), average: done > 0 ? round2((earned / done) * 100) : null, complete: all && periods.length > 0 };
}
