'use server';

// Server actions: planes de refuerzo personalizados (remediation_plans)
// Fase 11 · Sesion E.2 · Stud.ia
//
// El profesor crea un plan enfocado en los conceptos mas debiles de un
// estudiante (calculados client-side desde ConceptGapData, Sesion C) y el
// estudiante lo avanza a su ritmo reutilizando el modo "repaso" de
// /api/generate-questions (Sesion E.1).

import { createServerSupabase } from '@/lib/supabase/server';

export interface RemediationPlan {
  id: string;
  student_id: string;
  classroom_id: string;
  created_by: string;
  title: string;
  target_concepts: string[];
  status: 'active' | 'completed' | 'cancelled';
  modules_target: number;
  modules_completed: number;
  created_at: string;
  completed_at: string | null;
}

function formatConceptLabel(tag: string): string {
  const s = tag.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function createRemediationPlan(
  studentId: string,
  classroomId: string,
  targetConcepts: string[]
): Promise<{ ok: true; plan: RemediationPlan } | { ok: false; error: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado.' };

  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, teacher_id')
    .eq('id', classroomId)
    .single();
  if (!classroom || (classroom as any).teacher_id !== user.id) {
    return { ok: false, error: 'No tienes permiso sobre esta clase.' };
  }

  if (!targetConcepts.length) {
    return { ok: false, error: 'No hay conceptos débiles para este estudiante.' };
  }

  const title = `Plan de Refuerzo: ${formatConceptLabel(targetConcepts[0])}`;

  const { data: plan, error } = await supabase
    .from('remediation_plans')
    .insert({
      student_id: studentId,
      classroom_id: classroomId,
      created_by: user.id,
      title,
      target_concepts: targetConcepts,
      status: 'active',
      modules_target: 5,
      modules_completed: 0,
    })
    .select('*')
    .single();

  if (error || !plan) {
    return { ok: false, error: error?.message || 'No se pudo crear el plan.' };
  }

  return { ok: true, plan: plan as RemediationPlan };
}

export async function getActiveRemediationPlans(
  classroomId: string
): Promise<Record<string, RemediationPlan>> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return {};

  const { data: plans } = await supabase
    .from('remediation_plans')
    .select('*')
    .eq('classroom_id', classroomId)
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false });

  const byStudent: Record<string, RemediationPlan> = {};
  for (const p of (plans ?? []) as RemediationPlan[]) {
    // Solo el mas reciente por estudiante.
    if (!byStudent[p.student_id]) byStudent[p.student_id] = p;
  }
  return byStudent;
}

export async function getMyActiveRemediationPlan(): Promise<RemediationPlan | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: plan } = await supabase
    .from('remediation_plans')
    .select('*')
    .eq('student_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (plan as RemediationPlan) ?? null;
}

export async function advanceRemediationPlan(
  planId: string,
  scorePercent: number
): Promise<{ ok: true; completed: boolean; bonusXp: number } | { ok: false; error: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado.' };

  const { data: plan } = await supabase
    .from('remediation_plans')
    .select('*')
    .eq('id', planId)
    .eq('student_id', user.id)
    .single();
  if (!plan) return { ok: false, error: 'Plan no encontrado.' };

  const p = plan as RemediationPlan;
  const bonusXp = Math.round(15 + (scorePercent / 100) * 15); // 15-30 por ronda
  const modulesCompleted = p.modules_completed + 1;
  const completed = modulesCompleted >= p.modules_target;

  const { error } = await supabase
    .from('remediation_plans')
    .update({
      modules_completed: modulesCompleted,
      status: completed ? 'completed' : 'active',
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq('id', planId);
  if (error) return { ok: false, error: error.message };

  const { data: profile } = await supabase
    .from('profiles')
    .select('total_xp')
    .eq('id', user.id)
    .single();
  await supabase
    .from('profiles')
    .update({ total_xp: ((profile as any)?.total_xp ?? 0) + bonusXp })
    .eq('id', user.id);

  return { ok: true, completed, bonusXp };
}
