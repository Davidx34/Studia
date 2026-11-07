import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import PlaybookClient from './PlaybookClient';

// Fase 3 de «IA que aprende»: cuaderno de estilo de la clase. El profesor escribe reglas, las guarda como version y activa la que quiere que lea el generador de preguntas.
export default async function PlaybookPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await (supabase as any)
    .from('ai_playbooks')
    .select('id, version, status, origin, rules, note, created_at, activated_at')
    .eq('classroom_id', params.id)
    .order('version', { ascending: false })
    .limit(50);
  // Cuadernos de OTRAS clases del mismo profesor (la RLS no deja ver los de nadie mas): el activo, o la version mas reciente si no hay activo.
  const { data: others } = await (supabase as any)
    .from('ai_playbooks')
    .select('id, classroom_id, version, status, rules, classrooms(name)')
    .neq('classroom_id', params.id)
    .order('version', { ascending: false })
    .limit(100);
  const byClass = new Map<string, any>();
  for (const o of others ?? []) {
    const prev = byClass.get(o.classroom_id);
    if (!prev || (o.status === 'active' && prev.status !== 'active')) byClass.set(o.classroom_id, o);
  }
  const sources = Array.from(byClass.values()).map((o) => ({ id: o.id, className: o.classrooms?.name ?? 'Otra clase', version: o.version, status: o.status, rules: o.rules }));
  return <PlaybookClient classroomId={params.id} versions={data ?? []} sources={sources} />;
}
