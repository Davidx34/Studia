import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { DashboardClient } from './DashboardClient';

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Cargar perfil
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // Módulo en progreso o siguiente disponible
  const { data: inProgress } = await supabase
    .from('student_progress')
    .select('*, content_modules(*)')
    .eq('student_id', user.id)
    .eq('status', 'in_progress')
    .order('last_attempt_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Misiones del día
  const today = new Date().toISOString().split('T')[0];
  const { data: missions } = await supabase
    .from('user_missions')
    .select('*, daily_missions(*)')
    .eq('user_id', user.id)
    .eq('assigned_date', today);

  // Achievements recientes (no vistos)
  const { data: recentAchievements } = await supabase
    .from('user_achievements')
    .select('*, achievements(*)')
    .eq('user_id', user.id)
    .order('earned_at', { ascending: false })
    .limit(3);

  // Stats: módulos completados totales
  const { count: totalCompleted } = await supabase
    .from('student_progress')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('status', 'completed');

  return (
    <DashboardClient
      profile={profile}
      inProgressModule={inProgress}
      missions={missions || []}
      recentAchievements={recentAchievements || []}
      totalCompleted={totalCompleted || 0}
    />
  );
}
