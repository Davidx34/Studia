import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { gradeAnswer } from '@/lib/grading/gradeAnswer';

// MODO SOMBRA de la calificacion en el servidor (fase 0 del plan). El navegador sigue calificando; esta ruta recibe
// la respuesta y el veredicto del navegador, califica por su cuenta y deja constancia de si coinciden. No devuelve
// el veredicto ni la clave al navegador (solo { ok: true }), y nunca afecta la leccion: ante cualquier problema
// responde igual de tranquila.
//
// Interruptor: GRADING_SHADOW=off en el servidor la apaga sin desplegar codigo nuevo.
export const maxDuration = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ANSWER_CHARS = 4000;

const quiet = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  try {
    if (process.env.GRADING_SHADOW === 'off') return quiet();

    const body = await req.json().catch(() => null);
    const questionId = typeof body?.questionId === 'string' ? body.questionId : '';
    const clientCorrect = body?.clientCorrect;
    if (!UUID_RE.test(questionId) || typeof clientCorrect !== 'boolean') return NextResponse.json({ error: 'Peticion invalida' }, { status: 400 });
    if (JSON.stringify(body.answer ?? null).length > MAX_ANSWER_CHARS) return NextResponse.json({ error: 'Respuesta demasiado grande' }, { status: 413 });

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    // Con la sesion del propio estudiante: la RLS solo le deja leer preguntas de sus clases.
    const { data: question } = await supabase
      .from('lesson_questions')
      .select('id, type, ok, answers, pairs, keywords')
      .eq('id', questionId)
      .maybeSingle();
    if (!question) return quiet();

    const graded = gradeAnswer(question, body.answer);
    if (graded.status !== 'graded') return quiet(); // minijuegos o forma inesperada: no hay nada que comparar

    // La tabla es nueva y aun no esta en los tipos generados.
    const { error } = await (supabase as any).from('grading_shadow_log').insert({
      student_id: user.id,
      question_id: question.id,
      question_type: question.type,
      client_correct: clientCorrect,
      server_correct: graded.correct,
      answer: body.answer,
    });
    if (error) console.warn('[lesson/shadow] no se pudo registrar:', error.message);
    return quiet();
  } catch (e) {
    console.warn('[lesson/shadow] error:', e);
    return quiet();
  }
}
