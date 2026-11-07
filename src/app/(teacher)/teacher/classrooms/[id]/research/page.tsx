import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import ResearchClient from './ResearchClient';

// La busqueda con fuentes puede tardar (hasta ~60 s): se permite en esta ruta, que es donde corre la accion del servidor.
export const maxDuration = 60;

// Fase 5 de «IA que aprende»: rutas de investigacion con fuentes. Sugerencias para el profesor; no son material del curso.
export default async function ResearchPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await (supabase as any)
    .from('research_routes')
    .select('id, topic, answer, sources, cited_ratio, model, created_at')
    .eq('classroom_id', params.id)
    .order('created_at', { ascending: false })
    .limit(30);
  return <ResearchClient classroomId={params.id} routes={data ?? []} />;
}
