import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
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

  return <ReviewClient classroomId={params.id} questions={questions} />;
}
