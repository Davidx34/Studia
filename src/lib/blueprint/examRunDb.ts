// Adaptador de RunDb sobre el cliente de servicio de Supabase (las tablas nuevas aun no estan en los tipos generados, de ahi el `any`). Lanza si la base responde con un error inesperado (la
// ruta lo convierte en un 500 generico sin filtrar el mensaje); los rechazos ESPERADOS (sesion duplicada, evaluacion dominada, sesion vencida) se devuelven como resultado.

import { supabaseBankDb } from './examBankDb';
import { loadCourseData } from './studentData';
import type { CloseResult, CreateResult, NewSession, RunDb, SessionRow } from './examRun';

const COLUMNS = 'id, blueprint_id, classroom_id, student_id, kind, period_id, question_ids, layout, expires_at, closed_at, results, score_percent';

export function supabaseRunDb(admin: any): RunDb {
  const bank = supabaseBankDb(admin);
  return {
    async publishedPlan(classroomId) {
      const { data, error } = await admin.from('course_blueprints').select('id, version, doc').eq('classroom_id', classroomId).eq('status', 'published').maybeSingle();
      if (error) throw new Error(`run.plan: ${error.message ?? 'error'}`);
      return data ?? null;
    },
    async isEnrolled(classroomId, studentId) {
      const { data, error } = await admin.from('class_enrollments').select('student_id').eq('classroom_id', classroomId).eq('student_id', studentId).maybeSingle();
      if (error) throw new Error(`run.enrolled: ${error.message ?? 'error'}`);
      return !!data;
    },
    listQuestions: (blueprintId) => bank.listQuestions(blueprintId),
    // Con el cliente de servicio como `db`: no hay sesion de estudiante aqui; loadCourseData filtra por el estudiante que se le pasa.
    courseData: (classroomId, studentId) => loadCourseData({ db: admin, admin, classroomId, studentId }),
    async openSession(blueprintId, studentId, kind, periodId) {
      let q = admin.from('exam_sessions').select(COLUMNS).eq('blueprint_id', blueprintId).eq('student_id', studentId).eq('kind', kind).is('closed_at', null);
      q = periodId === null ? q.is('period_id', null) : q.eq('period_id', periodId);
      const { data, error } = await q.maybeSingle();
      if (error) throw new Error(`run.open: ${error.message ?? 'error'}`);
      return (data ?? null) as SessionRow | null;
    },
    async createSession(row: NewSession): Promise<CreateResult> {
      const { data, error } = await admin.from('exam_sessions').insert(row).select(COLUMNS).single();
      if (!error) return { ok: true, session: data as SessionRow };
      // 23505 = ya hay una abierta (carrera entre dos inicios). 23514 = una regla de la base: evaluacion dominada u otra.
      if (error.code === '23505') return { ok: false, reason: 'conflict' };
      if (error.code === '23514') return { ok: false, reason: /domino/i.test(String(error.message)) ? 'mastered' : 'rejected' };
      throw new Error(`run.create: ${error.message ?? 'error'}`);
    },
    async getSession(sessionId, studentId) {
      const { data, error } = await admin.from('exam_sessions').select(COLUMNS).eq('id', sessionId).eq('student_id', studentId).maybeSingle();
      if (error) throw new Error(`run.get: ${error.message ?? 'error'}`);
      return (data ?? null) as SessionRow | null;
    },
    async closeSession(sessionId, results, score): Promise<CloseResult> {
      const { data, error } = await admin.rpc('close_exam_session', { p_session: sessionId, p_results: results, p_score: score });
      if (!error) return typeof data === 'number' ? { ok: true, attemptNumber: data } : { ok: false, reason: 'missing' };
      const msg = String(error.message ?? '');
      if (error.code === '23514' || error.code === 'P0001') {
        if (/ya se cerro/i.test(msg)) return { ok: false, reason: 'closed' };
        if (/vencio/i.test(msg)) return { ok: false, reason: 'expired' };
        if (/domino/i.test(msg)) return { ok: false, reason: 'mastered' };
        if (/no existe/i.test(msg)) return { ok: false, reason: 'missing' };
      }
      throw new Error(`run.close: ${msg || 'error'}`);
    },
    async materialNames(materialIds) {
      if (materialIds.length === 0) return new Map();
      const { data, error } = await admin.from('teaching_materials').select('id, filename').in('id', materialIds);
      if (error) throw new Error(`run.materials: ${error.message ?? 'error'}`);
      return new Map(((data ?? []) as { id: string; filename: string | null }[]).map((m) => [m.id, m.filename ?? 'Material de la clase']));
    },
  };
}
