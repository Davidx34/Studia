'use server';

// Server actions para objetivos de aprendizaje y configuracion de modulos
// (Mejora Estructural 2). Todo el CRUD pasa por RLS de
// classroom_learning_objectives/content_modules (teacher_id = auth.uid()),
// asi que estas funciones solo agregan validacion de forma + revalidacion.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { regenerateModulePool, type RegeneratePoolResult } from '@/lib/questions/regeneratePool';
import { MINIGAME_RULES } from '@/lib/questions/cohereGeneration';

async function requireUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { supabase, user };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// ============================================================
// Objetivos
// ============================================================

export async function createLearningObjective(
  classroomId: string,
  data: { title: string; description?: string; expectedDurationWeeks?: number; difficultyLevel?: number }
): Promise<ActionResult & { id?: string }> {
  const { supabase, user } = await requireUser();

  if (!data.title?.trim()) return { ok: false, error: 'El titulo es obligatorio.' };

  const { data: inserted, error } = await supabase
    .from('classroom_learning_objectives')
    .insert({
      classroom_id: classroomId,
      teacher_id: user.id,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      expected_duration_weeks: data.expectedDurationWeeks || 4,
      difficulty_level: data.difficultyLevel || 5,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/teacher/classrooms/${classroomId}/objectives`);
  return { ok: true, id: inserted.id };
}

export async function updateLearningObjective(
  objectiveId: string,
  classroomId: string,
  data: { title: string; description?: string; expectedDurationWeeks?: number; difficultyLevel?: number }
): Promise<ActionResult> {
  const { supabase } = await requireUser();

  if (!data.title?.trim()) return { ok: false, error: 'El titulo es obligatorio.' };

  const { error } = await supabase
    .from('classroom_learning_objectives')
    .update({
      title: data.title.trim(),
      description: data.description?.trim() || null,
      expected_duration_weeks: data.expectedDurationWeeks || 4,
      difficulty_level: data.difficultyLevel || 5,
    })
    .eq('id', objectiveId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/teacher/classrooms/${classroomId}/objectives`);
  return { ok: true };
}

export async function deleteLearningObjective(objectiveId: string, classroomId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();

  const { error } = await supabase.from('classroom_learning_objectives').delete().eq('id', objectiveId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/teacher/classrooms/${classroomId}/objectives`);
  return { ok: true };
}

// ============================================================
// Configuracion de modulos dentro de un objetivo
// ============================================================

const VALID_MINIGAME_TYPES = Object.keys(MINIGAME_RULES);

export async function updateModuleObjectiveConfig(
  moduleId: string,
  classroomId: string,
  data: {
    learningObjectiveId: string | null;
    orderInObjective?: number | null;
    minigameTypes?: string[];
    configuredQuestionCount?: number;
  }
): Promise<ActionResult> {
  const { supabase } = await requireUser();

  const cleanMinigames = (data.minigameTypes || []).filter((mg) => VALID_MINIGAME_TYPES.includes(mg));
  const questionCount = Math.min(15, Math.max(5, data.configuredQuestionCount || 10));

  const { error } = await supabase
    .from('content_modules')
    .update({
      learning_objective_id: data.learningObjectiveId,
      order_in_objective: data.orderInObjective ?? null,
      minigame_types: cleanMinigames,
      configured_question_count: questionCount,
    })
    .eq('id', moduleId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/teacher/classrooms/${classroomId}/objectives`);
  return { ok: true };
}

// ============================================================
// Regenerar pool de preguntas de un modulo (activo + backup)
// ============================================================

export async function regenerateModuleQuestionPool(
  moduleId: string,
  classroomId: string
): Promise<RegeneratePoolResult> {
  const { supabase } = await requireUser();

  const result = await regenerateModulePool(supabase, moduleId);
  if (result.ok) {
    revalidatePath(`/teacher/classrooms/${classroomId}/objectives`);
  }
  return result;
}
