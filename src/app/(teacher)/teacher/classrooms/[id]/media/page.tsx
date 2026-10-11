import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import MediaClient from './MediaClient';

export default async function MediaPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
  if (!classroom) redirect('/teacher/classrooms');

  const [{ data: media }, { data: modules }] = await Promise.all([
    supabase.from('class_media' as any).select('id, kind, storage_path, mime_type, size_bytes, alt_text, caption, module_id, created_at').eq('classroom_id', params.id).order('created_at', { ascending: false }),
    supabase.from('content_modules').select('id, title').eq('classroom_id', params.id).order('order_index'),
  ]);

  return <MediaClient classroomId={params.id} initialMedia={(media as any) ?? []} modules={modules ?? []} />;
}
