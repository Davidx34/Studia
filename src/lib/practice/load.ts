// Carga las preguntas del modo practica de un estudiante en una clase. Solo LEE: la practica no escribe nada.
// `db` puede ser el cliente del usuario (RLS) o el de servicio; la consulta siempre se acota a SUS intentos.

import { buildPracticeQueue, PRACTICE_SIZE, toPracticeQuestion, type AttemptRow, type PracticeQuestion } from './session';

export interface PracticeData {
  questions: PracticeQuestion[];
  answeredTotal: number;
  wrongTotal: number;
}

const MAX_ATTEMPTS_READ = 500;

export async function loadPracticeQuestions(db: any, input: { studentId: string; classroomId: string; size?: number }): Promise<PracticeData> {
  const { data: attempts, error } = await db
    .from('question_attempts')
    .select('question_id, was_correct, attempted_at')
    .eq('student_id', input.studentId)
    .eq('classroom_id', input.classroomId)
    // Solo preguntas clasicas: los minijuegos guardan game_type y no se practican aqui.
    .is('game_type', null)
    .order('attempted_at', { ascending: false })
    .limit(MAX_ATTEMPTS_READ);
  if (error) throw new Error(String(error.message ?? error));

  const queue = buildPracticeQueue((attempts ?? []) as AttemptRow[], { size: input.size ?? PRACTICE_SIZE });
  if (queue.ids.length === 0) return { questions: [], answeredTotal: queue.answeredTotal, wrongTotal: queue.wrongTotal };

  // Las claves solo se piden de las preguntas que el estudiante ya cerro (queue.ids sale de SUS intentos).
  const { data: rows, error: qErr } = await db
    .from('lesson_questions')
    .select('id, type, q, opts, ok, answers, pairs, keywords, exp')
    .in('id', queue.ids);
  if (qErr) throw new Error(String(qErr.message ?? qErr));

  const byId = new Map<string, PracticeQuestion>();
  for (const r of rows ?? []) {
    const pq = toPracticeQuestion(r);
    if (pq) byId.set(pq.id, pq);
  }
  // Se conserva el orden de prioridad de la cola.
  const questions = queue.ids.map((id) => byId.get(id)).filter((q): q is PracticeQuestion => !!q);
  return { questions, answeredTotal: queue.answeredTotal, wrongTotal: queue.wrongTotal };
}
