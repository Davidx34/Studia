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
  return <PlaybookClient classroomId={params.id} versions={data ?? []} />;
}
