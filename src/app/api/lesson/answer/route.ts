import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { gradeAnswer } from '@/lib/grading/gradeAnswer';
import { buildReveal, isFinalTry, isServerGradedType, serverGradingEnabled, MAX_TRIES } from '@/lib/grading/serverGrading';

// Califica UNA respuesta de una leccion en el servidor. El navegador manda lo que respondio el estudiante; el servidor
// compara con la clave, cuenta los intentos de la pregunta y, al cerrarla (acierto o ultimo intento), registra el
// resultado en question_attempts y revela la respuesta correcta y la explicacion.
export const maxDuration = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ANSWER_CHARS = 4000;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  try {
    if (!serverGradingEnabled()) return fail(503, 'La calificacion en el servidor no esta activa.');

    const body = await req.json().catch(() => null);
    const attemptId = typeof body?.attemptId === 'string' ? body.attemptId : '';
    const questionId = typeof body?.questionId === 'string' ? body.questionId : '';
    if (!UUID_RE.test(attemptId) || !UUID_RE.test(questionId)) return fail(400, 'Peticion invalida');
    if (JSON.stringify(body.answer ?? null).length > MAX_ANSWER_CHARS) return fail(413, 'Respuesta demasiado grande');

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail(401, 'No autenticado');

    const admin: any = createAdminSupabase();

    // El intento tiene que ser del llamador, estar abierto y haber servido esta pregunta.
    const { data: attempt } = await admin
      .from('lesson_attempts')
      .select('id, module_id, question_ids, status')
      .eq('id', attemptId)
      .eq('student_id', user.id)
      .maybeSingle();
    if (!attempt || !(attempt.question_ids as string[]).includes(questionId)) return fail(404, 'Intento no encontrado');
    if (attempt.status !== 'in_progress') return fail(409, 'Este intento ya termino');

    const { data: question } = await admin
      .from('lesson_questions')
      .select('id, type, ok, answers, pairs, keywords, exp, concept_tag')
      .eq('id', questionId)
      .maybeSingle();
    if (!question || !isServerGradedType(question.type)) return fail(404, 'Pregunta no encontrada');

    const { data: prev } = await admin
      .from('lesson_attempt_answers')
      .select('tries, correct, final')
      .eq('attempt_id', attemptId)
      .eq('question_id', questionId)
      .maybeSingle();

    const closed = (correct: boolean, tries: number, detail?: unknown) =>
      NextResponse.json({
        correct,
        final: true,
        tries,
        detail,
        reveal: buildReveal(question),
        explanation: question.exp ?? null,
      });

    // Pregunta ya cerrada: repetir la respuesta no suma ni cambia nada, se devuelve el mismo resultado.
    if (prev?.final) return closed(!!prev.correct, prev.tries);

    const graded = gradeAnswer(question, body.answer);
    if (graded.status !== 'graded') return fail(400, 'Respuesta invalida');

    const triesUsed = (prev?.tries ?? 0) + 1;
    const final = isFinalTry(question.type, triesUsed, graded.correct);

    // Escritura con control de concurrencia: dos peticiones paralelas no pueden regalar intentos de mas.
    const row = { tries: triesUsed, correct: graded.correct, final, answer: body.answer, updated_at: new Date().toISOString() };
    if (!prev) {
      const { error } = await admin.from('lesson_attempt_answers').insert({ attempt_id: attemptId, question_id: questionId, ...row });
      if (error) return fail(409, 'Otra respuesta se estaba procesando, intenta de nuevo');
    } else {
      const { data: updated } = await admin
        .from('lesson_attempt_answers')
        .update(row)
        .eq('attempt_id', attemptId)
        .eq('question_id', questionId)
        .eq('tries', prev.tries)
        .select('tries');
      if (!updated || updated.length === 0) return fail(409, 'Otra respuesta se estaba procesando, intenta de nuevo');
    }

    if (!final) {
      // Intento fallido con otro por delante: solo se dice si acerto y, en emparejar, que conexiones.
      return NextResponse.json({
        correct: false,
        final: false,
        tries: triesUsed,
        triesLeft: (MAX_TRIES[question.type] ?? 1) - triesUsed,
        detail: graded.detail,
      });
    }

    // Cierre de la pregunta: queda registrada para las metricas del profesor, escrita por el servidor.
    const { data: mod } = await admin.from('content_modules').select('classroom_id').eq('id', attempt.module_id).maybeSingle();
    if (mod?.classroom_id) {
      const { error } = await admin.from('question_attempts').insert({
        student_id: user.id,
        question_id: questionId,
        module_id: attempt.module_id,
        classroom_id: mod.classroom_id,
        concept_tag: question.concept_tag ?? null,
        was_correct: graded.correct,
        answer_given: body.answer ?? null,
        game_type: null,
      });
      if (error) console.error('[LESSON_ANSWER_LOG_FAILED]', error.message);
    }

    return closed(graded.correct, triesUsed, graded.detail);
  } catch (e) {
    console.error('[lesson/answer] error:', e);
    return fail(500, 'Error inesperado');
  }
}
