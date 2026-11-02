import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import PlanClient, { type StoredPlan } from './PlanClient';

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
  const { data: rows, error } = await db.from('course_blueprints').select('version, status, doc, published_at').eq('classroom_id', params.id).order('version', { ascending: false });
  const list = (rows ?? []) as { version: number; status: 'draft' | 'published' | 'archived'; doc: unknown; published_at: string | null }[];
  const pick = (status: 'draft' | 'published'): StoredPlan | null => {
    const r = list.find((x) => x.status === status);
    return r ? { version: r.version, doc: r.doc, publishedAt: r.published_at } : null;
  };

  return <PlanClient classroomId={params.id} className={classroom.name ?? ''} draft={pick('draft')} published={pick('published')} tableMissing={!!error} />;
}
