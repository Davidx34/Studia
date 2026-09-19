// Que preguntas de un modulo puede ver el estudiante, y como se sortean.
//
// Antes, si el modulo tenia alguna pregunta ACTIVA solo se servia de ellas y la
// reserva no se usaba nunca; y si NO tenia activas, se servia de "todo", incluidas
// las preguntas que el juez o el profesor habian rechazado. Ahora:
//   - una pregunta rechazada no se sirve jamas;
//   - se sortea entre TODAS las demas, activas y de reserva, para que dos
//     estudiantes (o dos intentos) no vean siempre lo mismo.

import { isValidQuestion } from '@/lib/lesson/validateQuestion';

// Convierte una fila de lesson_questions al shape que espera el render de la leccion.
// Incluye id y concept_tag para que el cliente pueda registrar el intento en question_attempts.
export function rowToQuestion(row: any) {
  const q: any = { id: row.id, type: row.type, q: row.q, exp: row.exp, concept_tag: row.concept_tag ?? null };
  if (row.opts) q.opts = row.opts;
  if (row.ok !== null && row.ok !== undefined) q.ok = row.ok;
  if (row.answers) q.answers = row.answers;
  if (row.pairs) q.pairs = row.pairs;
  if (row.keywords) q.keywords = row.keywords;
  if (row.game_type) q.game_type = row.game_type;
  if (row.game_data) q.game_data = row.game_data;
  return q;
}

// Preguntas que se pueden servir: no rechazadas, completas y de un tipo que la
// configuracion actual de la clase todavia permite.
export function servableQuestions(rows: readonly any[], allowedTypes: ReadonlySet<string>) {
  return rows
    .filter((row) => row.review_status !== 'rejected')
    .map(rowToQuestion)
    .filter((q) => isValidQuestion(q).valid)
    .filter((q) => allowedTypes.has(q.type));
}

export function shuffled<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawQuestions<T>(pool: readonly T[], count: number, rng: () => number = Math.random): T[] {
  return shuffled(pool, rng).slice(0, count);
}
