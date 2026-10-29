import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import StudyGeneratorClient, { type MaterialRow } from './StudyGeneratorClient';
import type { FichaData } from '@/lib/study/fichaTemplates';
import { previewNodes, type PreviewModule } from '@/lib/map/mapSamples';

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
  // Plantilla de las fichas elegida para la clase (columna de la migracion 075: si aun no existe, la consulta falla y se usa la de siempre) y hasta 2 fichas
  // reales para la vista previa de las plantillas.
  const [tplRow, previewRows] = await Promise.all([
    db.from('classrooms').select('ficha_template').eq('id', params.id).maybeSingle(),
    ids.length
      ? db.from('study_cards').select('id, section, front, back, extra').in('material_id', ids).eq('kind', 'ficha').order('position').limit(2)
      : Promise.resolve({ data: [] }),
  ]);
  const fichaTemplate: string | null = tplRow.error ? null : (tplRow.data?.ficha_template ?? null);
  // Plantilla del mapa de la clase (migración 076: sin la columna, la consulta falla y se usa la de siempre) y sus módulos para la vista previa.
  const [mapTplRow, modRows] = await Promise.all([
    db.from('classrooms').select('map_template').eq('id', params.id).maybeSingle(),
    db
      .from('content_modules')
      .select('id, title, category, difficulty_level, order_index, map_position_x, map_position_y, prerequisites')
      .eq('classroom_id', params.id)
      .eq('is_active', true)
      .order('order_index')
      .limit(30),
  ]);
  const mapTemplate: string | null = mapTplRow.error ? null : (mapTplRow.data?.map_template ?? null);
  const mapPreview = previewNodes((modRows.data ?? []) as PreviewModule[]);

  const previewFichas: FichaData[] = ((previewRows.data ?? []) as FichaData[]).map((f) => ({ id: f.id, section: f.section, front: f.front, back: f.back, extra: f.extra }));

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

  return <StudyGeneratorClient classroomId={params.id} initialRows={rows} fichaTemplate={fichaTemplate} previewFichas={previewFichas} mapTemplate={mapTemplate} mapPreviewNodes={mapPreview.nodes} mapPreviewReal={mapPreview.real} />;
}
