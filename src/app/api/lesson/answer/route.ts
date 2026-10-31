import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { gradeAnswer } from '@/lib/grading/gradeAnswer';
import { buildReveal, isFinalTry, isServerGradedType, serverGradingEnabled, serverGradingGamesEnabled, MAX_TRIES } from '@/lib/grading/serverGrading';
import { buildGameReveal, gradeGame, isGradedGameType, probeGame } from '@/lib/grading/gameGrading';
import { findSourceHint } from '@/lib/grading/sourceHint';

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
      .select('id, type, q, opts, ok, answers, pairs, keywords, exp, concept_tag, game_data')
      .eq('id', questionId)
      .maybeSingle();
    // Un minijuego solo se califica aqui si SERVER_GRADING_GAMES esta activo: si no, se sirvio con su solucion y lo califica el navegador.
    const isGame = isGradedGameType(question?.type);
    if (!question || !(isGame ? serverGradingGamesEnabled() : isServerGradedType(question.type))) return fail(404, 'Pregunta no encontrada');

    const { data: prev } = await admin
      .from('lesson_attempt_answers')
      .select('tries, correct, final')
      .eq('attempt_id', attemptId)
      .eq('question_id', questionId)
      .maybeSingle();

    // Modulo y clase del intento (una sola lectura: la usan la pista de fuente y el registro de metricas).
    let modulePromise: Promise<{ classroom_id: string | null; source_material_ids: string[] | null } | null> | null = null;
    const getModule = () =>
      (modulePromise ??= Promise.resolve(admin.from('content_modules').select('classroom_id, source_material_ids').eq('id', attempt.module_id).maybeSingle()).then(
        (r: any) => r?.data ?? null
      ));

    // Al cerrar una pregunta FALLADA se busca en el material de la clase el pasaje mas probable ("Repasa en tu material").
    // Es una pista opcional: si algo falla o tarda, simplemente no se manda.
    const sourceFor = async (correct: boolean) => {
      if (correct || isGame) return null; // la pista de fuente se calcula con el enunciado de una pregunta clasica
      try {
        const mod = await getModule();
        if (!mod?.classroom_id) return null;
        return await findSourceHint(admin, {
          classroomId: mod.classroom_id,
          materialIds: Array.isArray(mod.source_material_ids) ? mod.source_material_ids : [],
          question,
        });
      } catch (e) {
        console.warn('[lesson/answer] source hint:', e instanceof Error ? e.message : e);
        return null;
      }
    };

    const reveal = isGame ? buildGameReveal(question.type, question.game_data) : buildReveal(question);
    const explanation = question.exp ?? (isGame ? ((reveal as { explanation?: string | null }).explanation ?? null) : null);

    const closed = async (correct: boolean, tries: number, detail?: unknown) =>
      NextResponse.json({
        correct,
        final: true,
        tries,
        detail,
        reveal,
        explanation,
        source: await sourceFor(correct),
      });

    // Pregunta ya cerrada: repetir la respuesta no suma ni cambia nada, se devuelve el mismo resultado.
    if (prev?.final) return await closed(!!prev.correct, prev.tries);

    // Sondeo de categorias ("¿esta categoria es la de este elemento?"): no cierra la pregunta, no gasta intentos y no escribe nada.
    const answerObj = body.answer && typeof body.answer === 'object' ? (body.answer as Record<string, unknown>) : null;
    if (isGame && answerObj && 'probe' in answerObj) {
      const probed = probeGame(question.type, question.game_data, answerObj.probe);
      if (probed.status !== 'graded') return fail(400, 'Respuesta invalida');
      return NextResponse.json({ correct: probed.correct, final: false, probe: true, ...(probed.data ? { detail: probed.data } : {}) });
    }

    const graded = isGame ? gradeGame(question.type, question.game_data, body.answer) : gradeAnswer(question, body.answer);
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
    const mod = await getModule();
    if (mod?.classroom_id) {
      const { error } = await admin.from('question_attempts').insert({
        student_id: user.id,
        question_id: questionId,
        module_id: attempt.module_id,
        classroom_id: mod.classroom_id,
        concept_tag: question.concept_tag ?? null,
        was_correct: graded.correct,
        answer_given: body.answer ?? null,
        game_type: isGame ? question.type : null,
      });
      if (error) console.error('[LESSON_ANSWER_LOG_FAILED]', error.message);
    }

    return await closed(graded.correct, triesUsed, graded.detail);
  } catch (e) {
    console.error('[lesson/answer] error:', e);
    return fail(500, 'Error inesperado');
  }
}
