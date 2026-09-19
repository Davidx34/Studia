import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import ObjectivesClient from './ObjectivesClient';
import { ALL_MINIGAME_IDS, sanitizeMinigameIds } from '@/lib/questions/minigameCatalog';
import { countServable, resolveQuestionCount, planFill } from '@/lib/questions/poolPlan';

export default async function ObjectivesPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: objectives } = await supabase
    .from('classroom_learning_objectives')
    .select('*')
    .eq('classroom_id', params.id)
    .order('created_at', { ascending: true });

  const { data: modules } = await supabase
    .from('content_modules')
    .select(
      'id, title, order_index, auto_generated, learning_objective_id, order_in_objective, minigame_types, configured_question_count, source_material_ids'
    )
    .eq('classroom_id', params.id)
    .order('order_index', { ascending: true });

  // Cuanto le falta a cada modulo para tener el pool completo (activas + reserva).
  const moduleIds = (modules ?? []).map((m) => m.id);
  const { data: poolRows } = moduleIds.length
    ? await supabase.from('lesson_questions').select('module_id, is_backup, review_status').in('module_id', moduleIds)
    : { data: [] as { module_id: string; is_backup: boolean; review_status: string }[] };
  const poolStatus: Record<string, { active: number; backup: number; missing: number }> = {};
  for (const m of modules ?? []) {
    const have = countServable((poolRows ?? []).filter((r) => r.module_id === m.id));
    const plan = planFill(resolveQuestionCount(m.configured_question_count), have);
    poolStatus[m.id] = { active: have.active, backup: have.backup, missing: plan.needActive + plan.needBackup };
  }

  const { data: materials } = await supabase
    .from('teaching_materials')
    .select('id, display_name, filename, processing_status')
    .eq('classroom_id', params.id)
    .order('created_at', { ascending: false });

  // Minijuegos habilitados para la clase (Cerebro de la IA). Sin fila = todos.
  const { data: aiConfig } = await supabase
    .from('classroom_ai_config')
    .select('minigame_types')
    .eq('classroom_id', params.id)
    .maybeSingle();
  const allowedMinigames = aiConfig?.minigame_types == null ? [...ALL_MINIGAME_IDS] : sanitizeMinigameIds(aiConfig.minigame_types);

  return (
    <ObjectivesClient
      classroomId={params.id}
      objectives={objectives ?? []}
      modules={modules ?? []}
      materials={materials ?? []}
      allowedMinigames={allowedMinigames}
      poolStatus={poolStatus}
    />
  );
}
