// Lee lo que necesita el monitor de regresion de UNA clase y arma el informe. Nunca lanza: ante cualquier fallo devuelve null (la pantalla simplemente no muestra la tarjeta).
// `db` debe poder leer ai_playbooks, lesson_questions y ai_feedback_events (ai_feedback_events es solo de servidor: usar la llave de servicio SOLO tras comprobar que la clase es del profesor).
import { loadClassroomCalibration } from './calibrationLoader';
import { monitorReport, type MonitorReport, type PlaybookVersionRow, type QuestionRow } from './regressionMonitor';

type DbLike = { from: (t: string) => any };
const PAGE = 1000;
const MAX_ROWS = 10000;

export async function loadMonitorReport(db: DbLike | null, classroomId: string): Promise<MonitorReport | null> {
  if (!db) return null;
  try {
    const { data: pbs, error: e1 } = await db.from('ai_playbooks').select('id, version, status, activated_at').eq('classroom_id', classroomId).order('version', { ascending: true }).limit(200);
    if (e1) return null;
    const { data: mods, error: e2 } = await db.from('content_modules').select('id').eq('classroom_id', classroomId);
    if (e2) return null;
    const ids = (mods ?? []).map((m: any) => m.id);
    const questions: QuestionRow[] = [];
    let humanReviewPending = 0;
    if (ids.length) {
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const { data, error } = await db.from('lesson_questions').select('created_at, review_status, review_reason, reviewed_by').in('module_id', ids).order('created_at', { ascending: true }).range(from, from + PAGE - 1);
        if (error) return null;
        questions.push(...((data ?? []) as QuestionRow[]));
        if (!data || data.length < PAGE) break;
      }
      humanReviewPending = questions.filter((q) => q.review_status === 'human_review').length;
    }
    const calibration = await loadClassroomCalibration(db, classroomId);
    return monitorReport({ playbooks: (pbs ?? []) as PlaybookVersionRow[], questions, calibration, humanReviewPending });
  } catch {
    return null;
  }
}
