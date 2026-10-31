import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { serverGradingEnabled } from '@/lib/grading/serverGrading';

// Cierra una leccion en el servidor (fase 2a del plan docs/PLAN_CALIFICACION_EN_SERVIDOR.md). El navegador solo dice QUE intento termina y cuanto tiempo estuvo; el puntaje, el
// estado y los intentos los calcula y escribe la funcion finish_lesson (migracion 084) desde las respuestas que el servidor ya califico. Ni el puntaje ni "completado" salen del navegador.
export const maxDuration = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SECONDS = 2 * 60 * 60;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(req: NextRequest) {
  try {
    if (!serverGradingEnabled()) return fail(503, 'La calificacion en el servidor no esta activa.');

    const body = await req.json().catch(() => null);
    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId : '';
    if (!UUID_RE.test(attemptId)) return fail(400, 'Peticion invalida');
    // El tiempo es un dato del navegador: se acota aqui y la funcion lo acota otra vez contra el reloj del servidor.
    const raw = Number(body?.elapsedSeconds);
    const seconds = Number.isFinite(raw) ? Math.max(0, Math.min(MAX_SECONDS, Math.round(raw))) : 0;

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail(401, 'No autenticado');

    const admin: any = createAdminSupabase();
    const { data, error } = await admin.rpc('finish_lesson', { p_attempt_id: attemptId, p_student_id: user.id, p_client_seconds: seconds });
    if (error) {
      // Migracion 084 sin aplicar: el navegador sigue como antes.
      if (error.code === 'PGRST202' || (/finish_lesson/.test(String(error.message)) && /does not exist|not find|schema cache/i.test(String(error.message)))) {
        return fail(501, 'El cierre en el servidor no esta disponible.');
      }
      console.error('[LESSON_FINISH_FAILED]', { code: error.code, message: error.message });
      return fail(500, 'Error inesperado');
    }

    if (data?.ok === true) {
      return NextResponse.json({ score: data.score, correct: data.correct, total: data.total, seconds: data.seconds, already: !!data.already });
    }
    switch (data?.error) {
      case 'not_found':
        return fail(404, 'Intento no encontrado');
      case 'unanswered':
        return fail(409, 'Quedan preguntas sin responder', { answered: data.answered, total: data.total });
      case 'nothing_to_grade':
        return fail(422, 'Este intento no tiene preguntas que el servidor califique');
      default:
        return fail(400, 'Peticion invalida');
    }
  } catch (e) {
    console.error('[lesson/finish] error:', e);
    return fail(500, 'Error inesperado');
  }
}
