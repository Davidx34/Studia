import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import type { BenchmarkRow } from '@/lib/aiLearning/benchmark';
import GlobalClient from './GlobalClient';

// Fase 7 de «IA que aprende»: aporte opcional y anonimo a la memoria global, y referencia del estrato de la clase (solo si la clase aporta).
export default async function GlobalPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: own } = await supabase.from('classrooms').select('id').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
  if (!own) redirect('/teacher/classrooms');

  const { data: profile } = await (supabase as any)
    .from('classroom_benchmark_profile')
    .select('subject, level, age_band, share_opt_in, opted_in_at, consent_version')
    .eq('classroom_id', params.id)
    .maybeSingle();

  // Reciprocidad: solo quien aporta ve la referencia, y solo las filas de SU estrato (global_benchmarks es de servidor).
  let rows: BenchmarkRow[] = [];
  if (profile?.share_opt_in && hasServiceRoleKey()) {
    try {
      const { data } = await (createAdminSupabase() as any)
        .from('global_benchmarks')
        .select('question_type, n_classes, n_teachers, attempts, correct_rate')
        .eq('subject', profile.subject)
        .eq('level', profile.level)
        .eq('age_band', profile.age_band)
        .order('question_type');
      rows = ((data ?? []) as any[]).map((r) => ({ ...r, correct_rate: Number(r.correct_rate) }));
    } catch {
      rows = [];
    }
  }
  return (
    <GlobalClient
      classroomId={params.id}
      profile={profile ? { subject: profile.subject, level: profile.level, ageBand: profile.age_band, share: profile.share_opt_in, optedInAt: profile.opted_in_at } : null}
      rows={rows}
    />
  );
}
