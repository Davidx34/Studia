'use server';

// Server actions para mapa de clase (auto-generated modules)
// Fase 11.D · Stud.ia
//
// Wrappers sobre las edge functions generate-classroom-map y
// generate-lesson-from-material. Validan ownership/enrollment del lado server
// antes de invocar.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import type { GenerateLessonResponse } from '@/types/database';

async function requireUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { supabase, user };
}

// ============================================================
// generateClassroomMap (lo dispara el profesor)
// ============================================================

export interface GenerateMapResult {
  ok: boolean;
  modulesCreated?: number;
  error?: string;
}

export async function generateClassroomMap(classroomId: string): Promise<GenerateMapResult> {
  const { supabase, user } = await requireUser();

  // Verificar ownership
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id')
    .eq('id', classroomId)
    .eq('teacher_id', user.id)
    .single();
  if (!classroom) return { ok: false, error: 'Clase no encontrada o sin permisos.' };

  // Verificar que haya al menos un material procesado
  const { data: mats } = await supabase
    .from('teaching_materials')
    .select('id')
    .eq('classroom_id', classroomId)
    .eq('processing_status', 'completed')
    .limit(1);
  if (!mats || mats.length === 0) {
    return {
      ok: false,
      error: 'Necesitas al menos un material procesado para generar el mapa.',
    };
  }

  // Invocar edge function
  const { data, error } = await supabase.functions.invoke('generate-classroom-map', {
    body: { classroom_id: classroomId },
  });

  if (error) {
    return { ok: false, error: `Edge function falló: ${error.message}` };
  }
  if (!data?.ok) {
    return { ok: false, error: data?.error ?? 'Error desconocido.' };
  }

  revalidatePath(`/teacher/classrooms/${classroomId}/modules`);
  revalidatePath(`/teacher/classrooms/${classroomId}`);

  return { ok: true, modulesCreated: data.modules_created };
}

// ============================================================
// regenerateClassroomMap (borra módulos auto-generados + invalidate cache + re-genera)
// ============================================================

export async function regenerateClassroomMap(classroomId: string): Promise<GenerateMapResult> {
  const { supabase, user } = await requireUser();

  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id')
    .eq('id', classroomId)
    .eq('teacher_id', user.id)
    .single();
  if (!classroom) return { ok: false, error: 'Clase no encontrada o sin permisos.' };

  // 1. Borrar módulos auto-generados de la clase (cascade student_progress + generated_questions)
  const { error: delErr } = await supabase
    .from('content_modules')
    .delete()
    .eq('classroom_id', classroomId)
    .eq('auto_generated', true);
  if (delErr) return { ok: false, error: `Borrando módulos: ${delErr.message}` };

  // 2. Invalidar cache de lecciones
  await supabase.rpc('invalidate_lesson_cache', {
    p_classroom_id: classroomId,
  } as any);

  // 3. Re-generar
  return generateClassroomMap(classroomId);
}

// ============================================================
// deleteAutoModule
// ============================================================

export async function deleteAutoModule(moduleId: string) {
  const { supabase, user } = await requireUser();

  // Lookup para verificar ownership y obtener classroom
  const { data: module } = await supabase
    .from('content_modules')
    .select('id, classroom_id, teacher_id')
    .eq('id', moduleId)
    .eq('teacher_id', user.id)
    .single();
  if (!module) return { ok: false as const, error: 'Módulo no encontrado o sin permisos.' };

  const { error } = await supabase.from('content_modules').delete().eq('id', moduleId);
  if (error) return { ok: false as const, error: error.message };

  if (module.classroom_id) {
    await supabase.rpc('invalidate_lesson_cache', {
      p_classroom_id: module.classroom_id,
    } as any);
    revalidatePath(`/teacher/classrooms/${module.classroom_id}/modules`);
  }
  return { ok: true as const };
}

// ============================================================
// generateLessonFromMaterial (lo dispara el estudiante desde el cliente)
// ============================================================

export async function generateLessonFromMaterial(
  moduleId: string,
  questionCount = 5
): Promise<GenerateLessonResponse> {
  const { supabase, user } = await requireUser();

  // Verificar que el módulo existe + es auto_generated + el estudiante tiene
  // acceso (está inscrito en la classroom)
  const { data: module } = await supabase
    .from('content_modules')
    .select('id, classroom_id, auto_generated')
    .eq('id', moduleId)
    .single();
  if (!module || !module.auto_generated || !module.classroom_id) {
    return { ok: false, error: 'Módulo no es auto-generado o no existe.' };
  }

  const { data: enrollment } = await supabase
    .from('class_enrollments')
    .select('id')
    .eq('classroom_id', module.classroom_id)
    .eq('student_id', user.id)
    .maybeSingle();
  if (!enrollment) {
    return { ok: false, error: 'No estás inscrito en esta clase.' };
  }

  const { data, error } = await supabase.functions.invoke('generate-lesson-from-material', {
    body: {
      module_id: moduleId,
      student_id: user.id,
      question_count: questionCount,
    },
  });

  if (error) return { ok: false, error: `Edge function falló: ${error.message}` };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'Error desconocido.' };

  return data as GenerateLessonResponse;
}
