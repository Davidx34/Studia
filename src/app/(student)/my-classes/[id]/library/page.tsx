import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { LibraryClient } from './LibraryClient';

export default async function ClassroomLibraryPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: enrollment } = await supabase
    .from('class_enrollments')
    .select('*')
    .eq('classroom_id', params.id)
    .eq('student_id', user.id)
    .single();
  if (!enrollment) redirect('/dashboard');

  const { data: classroom } = await supabase
    .from('classrooms')
    .select('name')
    .eq('id', params.id)
    .single();
  if (!classroom) redirect('/dashboard');

  const { data: materials } = await supabase
    .from('teaching_materials')
    .select(
      'id, display_name, chunk_count, topics_detected, created_at, source_type, external_url, external_title, external_favicon'
    )
    .eq('classroom_id', params.id)
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: false });

  return (
    <LibraryClient
      classroomId={params.id}
      classroomName={classroom.name}
      materials={(materials ?? []).map((m) => ({
        ...m,
        display_name: m.display_name ?? 'Sin título',
        created_at: m.created_at ?? new Date(0).toISOString(),
        source_type: m.source_type === 'link' || m.source_type === 'notebooklm' ? m.source_type : 'file',
      }))}
    />
  );
}
