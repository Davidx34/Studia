import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import { loadClassroomCalibration } from '@/lib/aiLearning/calibrationLoader';
import { flagQuestions, type StatRow } from '@/lib/aiLearning/questionFlags';
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

  // Fase 2 de «IA que aprende»: acuerdo del juez con TUS decisiones, y banderas de las estadisticas de estudiantes. Ambas viven en tablas solo de servidor (ai_feedback_events, question_stats): se leen con la llave
  // de servicio y SOLO si la clase es del profesor que mira. Si algo falla, la pagina funciona igual (esas tarjetas simplemente no aparecen).
  let calibration = null;
  let flagged: { questionId: string; kind: 'muy_dificil' | 'muy_facil'; attempts: number; rate: number; students: number; reason: string; type: string; q: string; moduleTitle: string }[] = [];
  let statsSummary: { total: number; belowMinimum: number } | null = null;
  try {
    const { data: own } = await supabase.from('classrooms').select('id').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
    if (own && hasServiceRoleKey()) {
      const admin = createAdminSupabase() as any;
      calibration = await loadClassroomCalibration(admin, params.id);

      const { data: stats } = await admin.from('question_stats').select('question_id, attempts, correct, correct_rate, distinct_students').eq('classroom_id', params.id).limit(5000);
      const result = flagQuestions((stats ?? []) as StatRow[]);
      statsSummary = { total: result.total, belowMinimum: result.belowMinimum };
      if (result.flags.length > 0) {
        const { data: qs } = await supabase.from('lesson_questions').select('id, type, q, module_id').in('id', result.flags.map((f) => f.questionId));
        const byId = new Map((qs ?? []).map((q: any) => [q.id, q]));
        flagged = result.flags
          .filter((f) => byId.has(f.questionId))
          .map((f) => {
            const q: any = byId.get(f.questionId);
            return { ...f, type: q.type, q: String(q.q ?? '').slice(0, 220), moduleTitle: titleByModule.get(q.module_id) ?? 'Módulo' };
          });
      }
    }
  } catch {
    calibration = null;
  }

  return <ReviewClient classroomId={params.id} questions={questions} calibration={calibration} flagged={flagged} statsSummary={statsSummary} />;
}
