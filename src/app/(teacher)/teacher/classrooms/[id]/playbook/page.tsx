import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import { loadMonitorReport } from '@/lib/aiLearning/monitorLoader';
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
  const { data: notes } = await (supabase as any).from('ai_class_notes').select('id, text, created_at').eq('classroom_id', params.id).eq('status', 'active').order('created_at', { ascending: true }).limit(15);
  // Monitor de regresion: lee tablas de servidor (ai_feedback_events) con la llave de servicio SOLO si la clase es del profesor que mira. Si algo falla, la tarjeta no aparece y la pagina funciona igual.
  let report = null;
  try {
    const { data: own } = await supabase.from('classrooms').select('id').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
    if (own && hasServiceRoleKey()) report = await loadMonitorReport(createAdminSupabase() as any, params.id);
  } catch {
    report = null;
  }
  return <PlaybookClient classroomId={params.id} versions={data ?? []} sources={sources} notes={notes ?? []} report={report} />;
}
