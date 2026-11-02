import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import PlanClient, { type StoredPlan } from './PlanClient';
import type { Link, RealModule } from '@/lib/blueprint/links';

// Plan del curso por cortes (docs/PLAN_POR_CORTES.md). Se LEE con la sesion del profesor (la RLS de la migracion 085 solo le muestra los planes de SUS clases); se ESCRIBE por
// /api/blueprint. Si la tabla aun no existe (migracion sin aplicar), la pantalla lo explica en vez de romperse.
export default async function TeacherPlanPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: classroom } = await supabase.from('classrooms').select('id, name').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
  if (!classroom) redirect('/teacher/classrooms');

  const db: any = supabase;
  const { data: rows, error } = await db.from('course_blueprints').select('id, version, status, doc, published_at').eq('classroom_id', params.id).order('version', { ascending: false });
  const list = (rows ?? []) as { id: string; version: number; status: 'draft' | 'published' | 'archived'; doc: unknown; published_at: string | null }[];
  const pick = (status: 'draft' | 'published'): StoredPlan | null => {
    const r = list.find((x) => x.status === status);
    return r ? { version: r.version, doc: r.doc, publishedAt: r.published_at } : null;
  };

  // Para enlazar: los modulos REALES de la clase y los enlaces ya guardados (tabla de la migracion 087; si aun no existe, el panel simplemente parte sin enlaces).
  const { data: mods } = await supabase.from('content_modules').select('id, title').eq('classroom_id', params.id).order('order_index', { ascending: true });
  const modules: RealModule[] = ((mods ?? []) as { id: string; title: string | null }[]).map((m) => ({ id: m.id, title: m.title ?? '' }));
  const { data: linkRows } = await db.from('blueprint_module_links').select('blueprint_id, node_id, content_module_id').eq('classroom_id', params.id);
  const linksOf = (status: 'draft' | 'published'): Link[] => {
    const bp = list.find((x) => x.status === status);
    return bp ? ((linkRows ?? []) as { blueprint_id: string; node_id: string; content_module_id: string }[]).filter((l) => l.blueprint_id === bp.id).map((l) => ({ nodeId: l.node_id, moduleId: l.content_module_id })) : [];
  };

  return (
    <PlanClient
      classroomId={params.id}
      className={classroom.name ?? ''}
      draft={pick('draft')}
      published={pick('published')}
      tableMissing={!!error}
      modules={modules}
      draftLinks={linksOf('draft')}
      publishedLinks={linksOf('published')}
    />
  );
}
