'use server';

// Server action: getClassMastery
// Dominio de la clase para el profesor (por modulo y objetivo; quienes necesitan repaso). Misma verificacion de propiedad que
// getClassroomProgress / getConceptGapData (defensa en profundidad junto con RLS). Solo lectura.

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { buildClassMastery, type ClassMastery } from '@/lib/mastery/classMastery';
import { fetchClassAttempts } from '@/lib/mastery/loadClass';

export interface ClassMasteryResult {
  mastery: ClassMastery;
  // Se alcanzo el tope de lectura: los numeros pueden estar incompletos.
  truncated: boolean;
}

export async function getClassMastery(classroomId: string): Promise<{ ok: boolean; data?: ClassMasteryResult; error?: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', user.id).single();
  if (!classroom) return { ok: false, error: 'Clase no encontrada o sin permisos.' };

  try {
    // Los mismos modulos que ve el estudiante (generados y activos), en su orden.
    const { data: modules } = await supabase
      .from('content_modules')
      .select('id, title, learning_objective_id, order_index')
      .eq('classroom_id', classroomId)
      .eq('auto_generated', true)
      .eq('is_active', true)
      .order('order_index');

    const { data: objectives } = await supabase.from('classroom_learning_objectives').select('id, title').eq('classroom_id', classroomId).order('created_at');

    const { data: enrollments } = await supabase.from('class_enrollments').select('student_id').eq('classroom_id', classroomId);
    const studentIds = (enrollments ?? []).map((e: any) => e.student_id as string);
    const { data: profiles } = studentIds.length > 0 ? await supabase.from('profiles').select('id, full_name, username').in('id', studentIds) : { data: [] };
    const students = (profiles ?? []).map((p: any) => ({ id: p.id as string, name: (p.full_name || p.username || 'Estudiante') as string }));

    const { rows, truncated } = students.length > 0 ? await fetchClassAttempts(supabase, classroomId) : { rows: [], truncated: false };

    const mastery = buildClassMastery({
      modules: (modules ?? []).map((m: any) => ({ id: m.id, title: m.title, objectiveId: m.learning_objective_id ?? null })),
      objectives: (objectives ?? []).map((o: any) => ({ id: o.id, title: o.title })),
      students,
      attempts: rows,
    });
    return { ok: true, data: { mastery, truncated } };
  } catch (e) {
    console.warn('[class-mastery]', e instanceof Error ? e.message : e);
    return { ok: false, error: 'No se pudo calcular el dominio de la clase.' };
  }
}
