import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import { calibrateJudge, type FeedbackEvent } from '@/lib/aiLearning/judgeCalibration';
import ReviewClient from './ReviewClient';

// Fase 1.3 (post-auditoria, Protocolo 7.5): pagina de revision humana.
// Lista las preguntas que el juez LLM marco como "human_review" (no las
// rechazadas -- esas ya se excluyeron solas via is_backup=true; no las
// aprobadas -- esas ya estan sirviendose) para que el profesor las
// resuelva a mano antes del piloto. Deliberadamente simple (tabla, sin
// paginacion ni filtros): el plan pide "que sea funcional", no bonita.
export default async function ReviewPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: modules } = await supabase
    .from('content_modules')
    .select('id, title')
    .eq('classroom_id', params.id);

  const moduleIds = (modules ?? []).map((m) => m.id);
  const titleByModule = new Map((modules ?? []).map((m) => [m.id, m.title]));

  const { data: pending } = moduleIds.length
    ? await supabase
        .from('lesson_questions')
        .select('*')
        .in('module_id', moduleIds)
        .eq('review_status', 'human_review')
        .order('module_id')
    : { data: [] as any[] };

  const questions = (pending ?? []).map((q) => ({
    ...q,
    moduleTitle: titleByModule.get(q.module_id) ?? 'Módulo',
  }));

  // Fase 2 de «IA que aprende»: acuerdo del juez con TUS decisiones. ai_feedback_events es solo de servidor, asi que se lee con la llave de servicio
  // y SOLO si la clase es del profesor que mira. Si algo falla, la pagina funciona igual (la tarjeta simplemente no aparece).
  let calibration = null;
  try {
    const { data: own } = await supabase.from('classrooms').select('id').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
    if (own && hasServiceRoleKey()) {
      const { data: events } = await (createAdminSupabase() as any)
        .from('ai_feedback_events')
        .select('question_id, signal, verdict, reason, created_at')
        .eq('classroom_id', params.id)
        .limit(10000);
      calibration = calibrateJudge((events ?? []) as FeedbackEvent[]);
    }
  } catch {
    calibration = null;
  }

  return <ReviewClient classroomId={params.id} questions={questions} calibration={calibration} />;
}
