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

  // Solo los materiales que el profesor YA preparo (con fichas, flashcards o infografias). El estudiante no genera.
  const ids = (materials ?? []).map((m) => m.id);
  const db: any = supabase;
  const { data: cardRows } = ids.length ? await db.from('study_cards').select('material_id, kind').in('material_id', ids) : { data: [] };
  const rows = (cardRows ?? []) as { material_id: string; kind: string }[];
  const withContent = (materials ?? [])
    .map((m) => ({
      id: m.id,
      display_name: m.display_name ?? 'Material sin título',
      fichas: rows.filter((r) => r.material_id === m.id && r.kind === 'ficha').length,
      flashcards: rows.filter((r) => r.material_id === m.id && r.kind === 'flashcard').length,
      infographics: rows.filter((r) => r.material_id === m.id && r.kind === 'infografia').length,
    }))
    .filter((m) => m.fichas + m.flashcards + m.infographics > 0);

  return (
    <StudyClient
      userId={user.id}
      classroomId={params.id}
      classroomName={classroom.name}
      materials={withContent}
      initialMaterialId={searchParams.m ?? null}
    />
  );
}
