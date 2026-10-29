import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { MapSections } from './MapSections';
import { buildMapSections, buildNodes, type ClassroomRow, type ModuleRow, type ProgressRow } from '@/lib/map/mapSections';
import { CATEGORY_META } from '@/lib/map/mapSamples';

export default async function MapPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Cargar todos los módulos que el estudiante puede ver (los de sus clases y los generales)
  const { data: modules } = await supabase
    .from('content_modules')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('order_index');

  // Cargar progreso del estudiante
  const { data: progress } = await supabase.from('student_progress').select('*').eq('student_id', user.id);

  if (!modules) {
    return <p className="theme-scope text-fg">No hay módulos disponibles.</p>;
  }

  // Sus clases y la plantilla de mapa que eligió el profesor de cada una (columna map_template de la migración 076: si aún no existe, la consulta con ella falla y
  // se vuelve a pedir sin ella, así todo se ve como hasta hoy).
  const db: any = supabase;
  const { data: enrollments } = await supabase.from('class_enrollments').select('classroom_id').eq('student_id', user.id);
  const classIds = Array.from(new Set((enrollments ?? []).map((e) => e.classroom_id).filter((id): id is string => !!id)));
  let classrooms: ClassroomRow[] = [];
  if (classIds.length > 0) {
    const withTemplate = await db.from('classrooms').select('id, name, map_template').in('id', classIds);
    const res = withTemplate.error ? await db.from('classrooms').select('id, name').in('id', classIds) : withTemplate;
    classrooms = (res.data ?? []) as ClassroomRow[];
  }

  const items = buildNodes(modules as unknown as ModuleRow[], (progress ?? []) as unknown as ProgressRow[]);
  const sections = buildMapSections(items, classrooms);

  return <MapSections sections={sections} categoryMeta={CATEGORY_META} />;
}
