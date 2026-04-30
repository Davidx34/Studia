import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { AchievementsClient } from './AchievementsClient';

export default async function AchievementsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Cargar TODOS los achievements activos
  const { data: allAchievements } = await supabase
    .from('achievements')
    .select('*')
    .eq('is_active', true)
    .order('rarity')
    .order('sort_order');

  // Cargar los del usuario
  const { data: userAchievements } = await supabase
    .from('user_achievements')
    .select('achievement_id, earned_at, seen_by_user')
    .eq('user_id', user.id);

  // Cargar perfil para el contexto de progreso
  const { data: profile } = await supabase
    .from('profiles')
    .select('total_xp, streak_days, current_level')
    .eq('id', user.id)
    .single();

  // Calcular métricas para mostrar progreso de logros bloqueados
  const { count: completedModules } = await supabase
    .from('student_progress')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('status', 'completed');

  const { count: perfectScores } = await supabase
    .from('student_progress')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('status', 'completed')
    .eq('best_score', 100);

  // Conteo por categoría completada
  const { data: categoryProgress } = await supabase
    .from('student_progress')
    .select('content_modules(category)')
    .eq('student_id', user.id)
    .eq('status', 'completed');

  const categoryCompleted: Record<string, number> = {};
  for (const row of categoryProgress || []) {
    const cat = (row.content_modules as any)?.category;
    if (cat) categoryCompleted[cat] = (categoryCompleted[cat] || 0) + 1;
  }

  // Marcar todos los achievements como vistos al cargar la página
  if (userAchievements?.some((ua) => !ua.seen_by_user)) {
    await supabase
      .from('user_achievements')
      .update({ seen_by_user: true })
      .eq('user_id', user.id)
      .eq('seen_by_user', false);
  }

  return (
    <AchievementsClient
      allAchievements={allAchievements || []}
      userAchievements={userAchievements || []}
      progressContext={{
        totalXP: profile?.total_xp || 0,
        streakDays: profile?.streak_days || 0,
        modulesCompleted: completedModules || 0,
        perfectScores: perfectScores || 0,
        categoryCompleted,
      }}
    />
  );
}
