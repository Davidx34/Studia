import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { rowToItem, sortItems, type LabRow } from '@/lib/lab/labRows';
import { NO_MEMORY, type MemorySummary } from '@/lib/memory/panelState';
import LabManagerClient from './LabManagerClient';
import MemoryPanel from './MemoryPanel';

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

  // Memoria de la clase (migracion 079: si aun no existe, la consulta falla y el panel lo explica).
  const memRes = await db.from('class_memory').select('status, version, built_at, started_at, error, stats').eq('classroom_id', params.id).maybeSingle();
  const memory: MemorySummary = memRes.data
    ? { status: memRes.data.status, version: memRes.data.version, builtAt: memRes.data.built_at, startedAt: memRes.data.started_at, error: memRes.data.error, stats: memRes.data.stats }
    : NO_MEMORY;

  const items = sortItems(((rows ?? []) as LabRow[]).map(rowToItem));

  return (
    <div className="space-y-6">
      <MemoryPanel classroomId={params.id} initial={memory} materialCount={(materials ?? []).length} tableMissing={!!memRes.error} />
      <LabManagerClient
        classroomId={params.id}
        teacherId={user.id}
        initialItems={items}
        memoryReady={memory.status === 'ready' && (memory.stats?.concepts ?? 0) > 0}
        tableMissing={!!error}
      />
    </div>
  );
}
