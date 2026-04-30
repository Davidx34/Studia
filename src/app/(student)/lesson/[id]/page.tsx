import { redirect, notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { LessonClient } from './LessonClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LessonPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Cargar el módulo
  const { data: module } = await supabase
    .from('content_modules')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .single();

  if (!module) notFound();

  // Verificar que los prerequisitos estén cumplidos
  const prereqs = (module.prerequisites as string[]) || [];
  if (prereqs.length > 0) {
    const { data: completedPrereqs } = await supabase
      .from('student_progress')
      .select('module_id')
      .eq('student_id', user.id)
      .eq('status', 'completed')
      .in('module_id', prereqs);

    if (!completedPrereqs || completedPrereqs.length < prereqs.length) {
      redirect('/map'); // No tiene acceso, redirige al mapa
    }
  }

  // Cargar progreso existente o crear "in_progress"
  const { data: existingProgress } = await supabase
    .from('student_progress')
    .select('*')
    .eq('student_id', user.id)
    .eq('module_id', id)
    .maybeSingle();

  if (!existingProgress) {
    await supabase.from('student_progress').insert({
      student_id: user.id,
      module_id: id,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
    });
  } else if (existingProgress.status !== 'completed') {
    await supabase
      .from('student_progress')
      .update({
        status: 'in_progress',
        last_attempt_at: new Date().toISOString(),
      })
      .eq('id', existingProgress.id);
  }

  // Cargar perfil para streak
  const { data: profile } = await supabase
    .from('profiles')
    .select('streak_days')
    .eq('id', user.id)
    .single();

  return (
    <LessonClient
      module={module}
      streakDays={profile?.streak_days || 0}
      previousScore={existingProgress?.best_score || null}
    />
  );
}
