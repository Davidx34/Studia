import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import StudyGeneratorClient, { type MaterialRow } from './StudyGeneratorClient';

// La generacion corre en segundo plano (waitUntil) y puede tardar minutos: la ruta que la dispara declara su propio
// maxDuration; esta pagina solo lee.
export default async function TeacherStudyPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
  if (!classroom) redirect('/teacher/classrooms');

  const { data: materials } = await supabase
    .from('teaching_materials')
    .select('id, display_name, filename, source_type, chunk_count, created_at')
    .eq('classroom_id', params.id)
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: false });

  const ids = (materials ?? []).map((m) => m.id);
  // Las tablas nuevas aun no estan en los tipos generados de Supabase.
  const db: any = supabase;
  const [cardRows, genRows, igRows] = ids.length
    ? await Promise.all([
        db.from('study_cards').select('material_id, kind').in('material_id', ids),
        db.from('study_card_generation').select('material_id, status, started_at, finished_at, card_count, error').in('material_id', ids),
        db.from('study_infographic_generation').select('material_id, status, started_at, finished_at, card_count, error').in('material_id', ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const count = (id: string, kind: string) => ((cardRows.data ?? []) as { material_id: string; kind: string }[]).filter((c) => c.material_id === id && c.kind === kind).length;
  const find = (rows: any[] | null, id: string) => (rows ?? []).find((r) => r.material_id === id) ?? null;

  const rows: MaterialRow[] = (materials ?? []).map((m) => ({
    id: m.id,
    name: m.display_name ?? m.filename ?? 'Material',
    sourceType: m.source_type,
    chunks: m.chunk_count ?? 0,
    fichas: count(m.id, 'ficha'),
    flashcards: count(m.id, 'flashcard'),
    infographics: count(m.id, 'infografia'),
    cards: find(genRows.data, m.id),
    ig: find(igRows.data, m.id),
  }));

  return <StudyGeneratorClient classroomId={params.id} initialRows={rows} />;
}
