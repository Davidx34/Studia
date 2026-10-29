import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { rowToItem, sortItems, type LabRow } from '@/lib/lab/labRows';
import LabManagerClient from './LabManagerClient';

export default async function TeacherLabPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
  if (!classroom) redirect('/teacher/classrooms');

  const { data: materials } = await supabase
    .from('teaching_materials')
    .select('id, display_name, filename')
    .eq('classroom_id', params.id)
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: false });

  // La tabla labs es de la migracion 078: si aun no existe, la consulta falla y el panel lo explica en vez de romperse.
  const db: any = supabase;
  const { data: rows, error } = await db.from('labs').select('*').eq('classroom_id', params.id);

  const items = sortItems(((rows ?? []) as LabRow[]).map(rowToItem));

  return (
    <LabManagerClient
      classroomId={params.id}
      teacherId={user.id}
      initialItems={items}
      materials={(materials ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.filename ?? 'Material' }))}
      tableMissing={!!error}
    />
  );
}
