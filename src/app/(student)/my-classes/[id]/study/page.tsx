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

  // Plantilla de las fichas que eligio el profesor (migracion 075). Si la columna aun no existe, la consulta falla y se usa la de siempre.
  const tpl = await (supabase as any).from('classrooms').select('ficha_template').eq('id', params.id).maybeSingle();
  const fichaTemplate: string | null = tpl.error ? null : (tpl.data?.ficha_template ?? null);
  // Plantilla de las infografías (migración 077; consulta aparte para que una columna que falte no afecte a la de las fichas).
  const igTpl = await (supabase as any).from('classrooms').select('infographic_template').eq('id', params.id).maybeSingle();
  const infographicTemplate: string | null = igTpl.error ? null : (igTpl.data?.infographic_template ?? null);

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
      fichaTemplate={fichaTemplate}
      infographicTemplate={infographicTemplate}
      materials={withContent}
      initialMaterialId={searchParams.m ?? null}
    />
  );
}
