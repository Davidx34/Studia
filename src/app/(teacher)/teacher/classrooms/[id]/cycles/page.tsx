import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import CyclesClient from './CyclesClient';

// Fase 4 de «IA que aprende»: ciclos cerrados y su retrospectiva.
export default async function CyclesPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const db = supabase as any;
  const [{ data: cycles }, { data: retros }] = await Promise.all([
    db.from('course_cycles').select('id, label, period_start, period_end, snapshot').eq('classroom_id', params.id).order('period_end', { ascending: false }).limit(20),
    db.from('cycle_retrospectives').select('id, cycle_id, findings, suggestions').eq('classroom_id', params.id).limit(20),
  ]);
  const byCycle = new Map<string, any>((retros ?? []).map((r: any) => [r.cycle_id, r]));
  const items = (cycles ?? []).map((c: any) => ({ ...c, retro: byCycle.get(c.id) ?? null }));
  return <CyclesClient classroomId={params.id} cycles={items} />;
}
