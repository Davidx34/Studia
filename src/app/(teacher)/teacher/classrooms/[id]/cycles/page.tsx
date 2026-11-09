import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { nextCycleChecklist } from '@/lib/aiLearning/carryOver';
import { SUGGESTION_PRINCIPLES } from '@/lib/aiLearning/retrospective';
import { principleBasis } from '@/lib/aiLearning/doctrine';
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
  // Fundamento de cada sugerencia: principios de la doctrina (con sus fuentes) segun el tipo de sugerencia. Se calcula aqui, no se guarda.
  const withBasis = (r: any) =>
    r
      ? {
          ...r,
          suggestions: (r.suggestions ?? []).map((s: any) => ({
            ...s,
            basis: ((SUGGESTION_PRINCIPLES as Record<string, string[]>)[s.kind] ?? []).map((id) => principleBasis(id)).filter(Boolean),
          })),
        }
      : null;
  const items = (cycles ?? []).map((c: any) => ({ ...c, retro: withBasis(byCycle.get(c.id)) }));
  // Fase 6: tareas para el ciclo actual = lo aceptado/pospuesto de la ultima retrospectiva (items viene del mas nuevo al mas viejo).
  const checklist = nextCycleChecklist(items.filter((c: any) => c.retro).map((c: any) => ({ label: c.label, suggestions: c.retro.suggestions })));
  return <CyclesClient classroomId={params.id} cycles={items} checklist={checklist} />;
}
