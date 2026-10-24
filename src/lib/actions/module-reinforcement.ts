'use server';

// Server actions: refuerzo dirigido desde "Dónde intervenir" (pestaña Dominio del progreso de la clase).
//
//   previewModuleReinforcement  -> SOLO LEE: a quien se le asignaria un plan y sobre que conceptos.
//   assignModuleReinforcement   -> crea un plan de refuerzo (remediation_plans) por cada estudiante en "por repasar" de ese modulo.
//
// La asignacion RECALCULA todo en el servidor (no recibe estudiantes ni conceptos del navegador): lo que se confirma en pantalla
// es una vista previa y lo que se crea sale de los datos actuales. Es idempotente: quien ya tiene un plan activo se omite, asi que
// repetir el clic no apila planes. Misma verificacion de propiedad de la clase que las demas vistas del profesor (y RLS la repite).

import { createServerSupabase } from '@/lib/supabase/server';
import { fetchClassAttempts } from '@/lib/mastery/loadClass';
import { conceptLabel, planReinforcement, type ReinforcementAssignment, type ReinforcementSkip } from '@/lib/mastery/reinforcement';

export interface ReinforcementPreview {
  moduleId: string;
  moduleTitle: string;
  assignments: ReinforcementAssignment[];
  skipped: ReinforcementSkip[];
}

type Built = { ok: true; supabase: any; userId: string; classroomId: string; preview: ReinforcementPreview } | { ok: false; error: string };

async function build(classroomId: string, moduleId: string): Promise<Built> {
  const supabase: any = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No autenticado.' };

  const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
  if (!classroom) return { ok: false, error: 'Clase no encontrada o sin permisos.' };

  const { data: mod } = await supabase.from('content_modules').select('id, title').eq('id', moduleId).eq('classroom_id', classroomId).maybeSingle();
  if (!mod) return { ok: false, error: 'Módulo no encontrado en esta clase.' };

  const { data: enrollments } = await supabase.from('class_enrollments').select('student_id').eq('classroom_id', classroomId);
  const studentIds = (enrollments ?? []).map((e: any) => e.student_id as string);
  if (studentIds.length === 0) return { ok: true, supabase, userId: user.id, classroomId, preview: { moduleId, moduleTitle: mod.title, assignments: [], skipped: [] } };

  const { data: profiles } = await supabase.from('profiles').select('id, full_name, username').in('id', studentIds);
  const students = (profiles ?? []).map((p: any) => ({ id: p.id as string, name: (p.full_name || p.username || 'Estudiante') as string }));

  const { rows } = await fetchClassAttempts(supabase, classroomId, { moduleId });
  const attemptsByStudent = new Map<string, any[]>();
  for (const r of rows) {
    const list = attemptsByStudent.get(r.student_id);
    if (list) list.push(r);
    else attemptsByStudent.set(r.student_id, [r]);
  }

  const { data: active } = await supabase.from('remediation_plans').select('student_id').eq('classroom_id', classroomId).eq('status', 'active');
  const activePlanStudentIds = new Set<string>((active ?? []).map((p: any) => p.student_id as string));

  const { assignments, skipped } = planReinforcement({ students, attemptsByStudent, activePlanStudentIds });
  return { ok: true, supabase, userId: user.id, classroomId, preview: { moduleId, moduleTitle: mod.title, assignments, skipped } };
}

export async function previewModuleReinforcement(classroomId: string, moduleId: string): Promise<{ ok: true; preview: ReinforcementPreview } | { ok: false; error: string }> {
  try {
    const b = await build(classroomId, moduleId);
    return b.ok ? { ok: true, preview: b.preview } : b;
  } catch (e) {
    console.warn('[module-reinforcement:preview]', e instanceof Error ? e.message : e);
    return { ok: false, error: 'No se pudo preparar el refuerzo.' };
  }
}

export async function assignModuleReinforcement(
  classroomId: string,
  moduleId: string
): Promise<{ ok: true; created: number; skipped: ReinforcementSkip[] } | { ok: false; error: string }> {
  try {
    const b = await build(classroomId, moduleId);
    if (!b.ok) return b;
    const { assignments, skipped } = b.preview;
    if (assignments.length === 0) return { ok: true, created: 0, skipped };

    const { error } = await b.supabase.from('remediation_plans').insert(
      assignments.map((a) => ({
        student_id: a.studentId,
        classroom_id: b.classroomId,
        created_by: b.userId,
        // Mismo formato de titulo que los planes creados desde "Por Estudiante" (la interfaz lo recorta por este prefijo).
        title: `Plan de Refuerzo: ${conceptLabel(a.concepts[0])}`,
        target_concepts: a.concepts,
        status: 'active',
        modules_target: 5,
        modules_completed: 0,
      }))
    );
    if (error) return { ok: false, error: error.message || 'No se pudieron crear los planes.' };
    return { ok: true, created: assignments.length, skipped };
  } catch (e) {
    console.warn('[module-reinforcement:assign]', e instanceof Error ? e.message : e);
    return { ok: false, error: 'No se pudo asignar el refuerzo.' };
  }
}
