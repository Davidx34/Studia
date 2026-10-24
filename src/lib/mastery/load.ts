// Lee los intentos de un estudiante en una clase, agrupados por modulo. Solo lectura. `db` puede ser el cliente del usuario
// (RLS: cada estudiante lee SUS intentos); la consulta siempre se acota a ese estudiante y esa clase.

import { groupAttemptsByModule, type AttemptLite } from './mastery';

const MAX_ROWS = 3000;

export async function loadModuleAttempts(db: any, input: { studentId: string; classroomId: string }): Promise<Map<string, AttemptLite[]>> {
  const { data, error } = await db
    .from('question_attempts')
    .select('module_id, question_id, was_correct, attempted_at')
    .eq('student_id', input.studentId)
    .eq('classroom_id', input.classroomId)
    .order('attempted_at', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(String(error.message ?? error));
  return groupAttemptsByModule((data ?? []) as any[]);
}
