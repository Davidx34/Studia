import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import ModulesClient from './ModulesClient';
import type { ContentModule } from '@/types/database';

export default async function ModulesPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: modules } = await supabase
    .from('content_modules')
    .select('*')
    .eq('classroom_id', params.id)
    .order('order_index', { ascending: true });

  const { data: completedMaterials } = await supabase
    .from('teaching_materials')
    .select('id')
    .eq('classroom_id', params.id)
    .eq('processing_status', 'completed');

  const moduleIds = (modules ?? []).map((m) => m.id);
  const completedByModule = new Map<string, number>();
  if (moduleIds.length > 0) {
    const { data: progressRows } = await supabase
      .from('student_progress')
      .select('module_id, status')
      .in('module_id', moduleIds)
      .eq('status', 'completed');
    for (const r of progressRows ?? []) {
      completedByModule.set(r.module_id, (completedByModule.get(r.module_id) ?? 0) + 1);
    }
  }

  return (
    <ModulesClient
      classroomId={params.id}
      modules={(modules ?? []) as ContentModule[]}
      hasCompletedMaterials={(completedMaterials?.length ?? 0) > 0}
      completedCounts={Object.fromEntries(completedByModule.entries())}
    />
  );
}
