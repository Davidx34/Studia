import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import ObjectivesClient from './ObjectivesClient';

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

  const { data: materials } = await supabase
    .from('teaching_materials')
    .select('id, display_name, filename, processing_status')
    .eq('classroom_id', params.id)
    .order('created_at', { ascending: false });

  return (
    <ObjectivesClient
      classroomId={params.id}
      objectives={objectives ?? []}
      modules={modules ?? []}
      materials={materials ?? []}
    />
  );
}
