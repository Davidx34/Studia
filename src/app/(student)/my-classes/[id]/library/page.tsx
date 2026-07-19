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
    .select('id, display_name, chunk_count, topics_detected, created_at')
    .eq('classroom_id', params.id)
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: false });

  return (
    <LibraryClient
      classroomId={params.id}
      classroomName={classroom.name}
      materials={materials || []}
    />
  );
}
