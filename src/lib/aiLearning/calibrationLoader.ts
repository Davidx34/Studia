// Calibracion del juez de UNA clase, leida de ai_feedback_events (tabla solo de servidor: requiere el cliente con llave de servicio, que el llamador pasa SOLO despues de comprobar que la clase es del profesor).
// Nunca lanza: ante cualquier fallo devuelve null y quien llama sigue como si no hubiera calibracion (no se actua sobre lo que no se pudo medir).

import { calibrateJudge, type Calibration, type FeedbackEvent } from './judgeCalibration';

type DbLike = { from: (t: string) => any };

export async function loadClassroomCalibration(admin: DbLike | null, classroomId: string): Promise<Calibration | null> {
  if (!admin) return null;
  try {
    const events: FeedbackEvent[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await admin.from('ai_feedback_events').select('question_id, signal, verdict, reason, created_at').eq('classroom_id', classroomId).range(from, from + 999);
      if (error) return null;
      events.push(...((data ?? []) as FeedbackEvent[]));
      if ((data?.length ?? 0) < 1000) break;
    }
    return calibrateJudge(events);
  } catch {
    return null;
  }
}
