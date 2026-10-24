// Lee TODOS los intentos de una clase para el profesor. Solo lectura.
// PostgREST devuelve como maximo 1000 filas por peticion, asi que se pagina. Con un tope de paginas para no quedarse
// leyendo sin fin: si se alcanza, se avisa (`truncated`) en vez de mostrar numeros incompletos como si fueran completos.

import type { ClassAttempt } from './classMastery';

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 20;

export async function fetchClassAttempts(db: any, classroomId: string, opts: { moduleId?: string } = {}): Promise<{ rows: ClassAttempt[]; truncated: boolean }> {
  const rows: ClassAttempt[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    let query = db
      .from('question_attempts')
      .select('student_id, module_id, question_id, was_correct, attempted_at, concept_tag')
      .eq('classroom_id', classroomId);
    // Un solo modulo (refuerzo dirigido): mucho menos que leer toda la clase.
    if (opts.moduleId) query = query.eq('module_id', opts.moduleId);
    const { data, error } = await query
      .order('attempted_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(String(error.message ?? error));
    const batch = (data ?? []) as ClassAttempt[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
