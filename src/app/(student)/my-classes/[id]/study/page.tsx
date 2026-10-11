import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { StudyClient } from './StudyClient';

export default async function StudyPage({ params, searchParams }: { params: { id: string }; searchParams: { m?: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: enrollment } = await supabase
    .from('class_enrollments')
    .select('classroom_id')
    .eq('classroom_id', params.id)
    .eq('student_id', user.id)
    .maybeSingle();
  if (!enrollment) redirect('/dashboard');

  const { data: classroom } = await supabase.from('classrooms').select('name').eq('id', params.id).single();
  if (!classroom) redirect('/dashboard');

  const { data: materials } = await supabase
    .from('teaching_materials')
    .select('id, display_name')
    .eq('classroom_id', params.id)
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: false });

  return (
    <StudyClient
      userId={user.id}
      classroomId={params.id}
      classroomName={classroom.name}
      materials={(materials ?? []).map((m) => ({ id: m.id, display_name: m.display_name ?? 'Material sin título' }))}
      initialMaterialId={searchParams.m ?? null}
    />
  );
}
