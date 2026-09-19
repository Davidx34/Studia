// Cuantas preguntas tiene un modulo y cuantas le faltan para tener el pool completo.
//
// El pool de un modulo son dos tandas: las ACTIVAS (las preguntas configuradas por
// el profesor) y la RESERVA (otras tantas de repuesto). El estudiante sortea entre
// todas las que sirven (ver poolServing.ts). Aqui solo se decide cuantas faltan;
// no se toca la base, para poder probarlo sin ella.

export const DEFAULT_QUESTION_COUNT = 10;
export const MIN_QUESTION_COUNT = 5;
export const MAX_QUESTION_COUNT = 15;

export function resolveQuestionCount(configured: number | null | undefined): number {
  return Math.min(MAX_QUESTION_COUNT, Math.max(MIN_QUESTION_COUNT, configured || DEFAULT_QUESTION_COUNT));
}

export interface PoolRow {
  is_backup: boolean | null;
  review_status: string | null;
}

export interface PoolCounts {
  active: number;
  backup: number;
}

// Una pregunta rechazada no sirve para nada: no cuenta como pool.
export function countServable(rows: readonly PoolRow[]): PoolCounts {
  let active = 0;
  let backup = 0;
  for (const r of rows) {
    if (r.review_status === 'rejected') continue;
    if (r.is_backup) backup++;
    else active++;
  }
  return { active, backup };
}

export interface FillPlan {
  needActive: number;
  needBackup: number;
  complete: boolean;
}

// La reserva es igual de grande que la tanda activa (misma regla que regeneratePool).
export function planFill(questionCount: number, have: PoolCounts): FillPlan {
  const needActive = Math.max(0, questionCount - have.active);
  const needBackup = Math.max(0, questionCount - have.backup);
  return { needActive, needBackup, complete: needActive === 0 && needBackup === 0 };
}
