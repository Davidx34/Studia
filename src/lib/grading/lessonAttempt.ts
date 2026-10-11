import { createAdminSupabase } from '@/lib/supabase/admin';
import { isServerGradedType, sanitizeQuestion, serverGradingEnabled } from './serverGrading';

// Al servir una leccion con calificacion del servidor: crea el intento (fija que preguntas se sirvieron) y entrega las
// preguntas clasicas SIN claves. Nunca rompe la leccion: si algo falla devuelve las preguntas como antes (el navegador
// las califica) y lo registra.
export async function startLessonAttempt(
  userClient: { auth: { getUser: () => PromiseLike<any> } },
  moduleId: string,
  questions: any[]
): Promise<{ questions: any[]; attemptId?: string }> {
  try {
    if (!serverGradingEnabled()) return { questions };
    const gradable = questions.filter((q) => q?.id && isServerGradedType(q.type));
    if (gradable.length === 0) return { questions };

    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return { questions };

    // Las tablas son nuevas y aun no estan en los tipos generados.
    const admin: any = createAdminSupabase();
    const { data, error } = await admin
      .from('lesson_attempts')
      .insert({ student_id: user.id, module_id: moduleId, question_ids: gradable.map((q) => q.id) })
      .select('id')
      .single();
    if (error || !data?.id) {
      console.error('[LESSON_ATTEMPT_CREATE_FAILED]', { moduleId, error: error?.message });
      return { questions };
    }
    return { questions: questions.map((q) => sanitizeQuestion(q)), attemptId: data.id };
  } catch (e) {
    console.error('[LESSON_ATTEMPT_ERROR]', e);
    return { questions };
  }
}
