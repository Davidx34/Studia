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
import { getRagContext } from '@/lib/questions/cohereGeneration';
import { judgeQuestionsBatch } from '@/lib/questions/judge';

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
    materialIds?: string[];
  }
): Promise<ActionResult> {
  const { supabase } = await requireUser();

  const cleanMinigames = (data.minigameTypes || []).filter((mg) => VALID_MINIGAME_TYPES.includes(mg));
  const questionCount = Math.min(15, Math.max(5, data.configuredQuestionCount || 10));

  const update: Record<string, unknown> = {
    learning_objective_id: data.learningObjectiveId,
    order_in_objective: data.orderInObjective ?? null,
    minigame_types: cleanMinigames,
    configured_question_count: questionCount,
  };
  if (data.materialIds) update.source_material_ids = data.materialIds;

  const { error } = await supabase.from('content_modules').update(update).eq('id', moduleId);

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


// ============================================================
// Fase 1.3 (post-auditoria): juez LLM asincrono sobre el pool ya generado
// ============================================================

export interface JudgeModuleResult extends ActionResult {
  total: number;
  approved: number;
  rejected: number;
  humanReview: number;
  judgeUnavailable: number; // GEMINI_API_KEY ausente o Gemini fallo -- se dejan en human_review para que el profesor las vea, nunca se pierden silenciosamente
}

// Corre el juez sobre TODAS las preguntas 'pending' de un modulo (activas +
// backup -- Protocolo 7.5: el pool completo, no solo lo que se sirve hoy).
// Se llama UNA VEZ POR MODULO desde el cliente (mismo patron que ya usa
// handleBulkGenerate para regenerateModuleQuestionPool) para no arriesgar
// el timeout de una funcion serverless corriendo el juez sobre los 18
// modulos de Microeconomia en una sola invocacion.
export async function judgeModuleQuestionPool(
  moduleId: string,
  classroomId: string
): Promise<JudgeModuleResult> {
  const { supabase } = await requireUser();

  const { data: pending, error: fetchError } = await supabase
    .from('lesson_questions')
    .select('*')
    .eq('module_id', moduleId)
    .eq('review_status', 'pending');

  if (fetchError) return { ok: false, error: fetchError.message, total: 0, approved: 0, rejected: 0, humanReview: 0, judgeUnavailable: 0 };
  if (!pending || pending.length === 0) return { ok: true, total: 0, approved: 0, rejected: 0, humanReview: 0, judgeUnavailable: 0 };

  const context = await getRagContext(supabase, moduleId);
  const verdicts = await judgeQuestionsBatch(pending, context);

  let approved = 0, rejected = 0, humanReview = 0, judgeUnavailable = 0;

  for (const q of pending) {
    const result = verdicts.get(q.id);
    if (!result) {
      // Gemini caido / sin API key / respuesta no parseable: NUNCA se
      // aprueba por omision -- se manda a revision humana, igual que un
      // veredicto "review" explicito, para que el profesor decida.
      judgeUnavailable++;
      await supabase
        .from('lesson_questions')
        .update({ review_status: 'human_review' })
        .eq('id', q.id);
      humanReview++;
      continue;
    }
    if (result.verdict === 'pass') {
      approved++;
      await supabase.from('lesson_questions').update({ review_status: 'approved' }).eq('id', q.id);
    } else if (result.verdict === 'fail') {
      rejected++;
      // is_backup=true saca la pregunta de circulacion activa de inmediato
      // -- una pregunta rechazada nunca debe poder servirse mientras nadie
      // la haya reemplazado. No se auto-reemplaza aqui (backfill desde el
      // pool de backup): eso queda para cuando haya senal real de cuantas
      // preguntas activas se pierden por rechazo en el piloto.
      await supabase.from('lesson_questions').update({ review_status: 'rejected', is_backup: true }).eq('id', q.id);
    } else {
      humanReview++;
      await supabase.from('lesson_questions').update({ review_status: 'human_review' }).eq('id', q.id);
    }
  }

  revalidatePath(`/teacher/classrooms/${classroomId}/objectives`);
  revalidatePath(`/teacher/classrooms/${classroomId}/review`);

  return { ok: true, total: pending.length, approved, rejected, humanReview, judgeUnavailable };
}

// Usadas desde la pagina de revision (/teacher/classrooms/[id]/review) para
// que el profesor resuelva a mano las preguntas en human_review antes del
// piloto.
export async function approveReviewQuestion(questionId: string, classroomId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('lesson_questions')
    .update({ review_status: 'approved' })
    .eq('id', questionId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/classrooms/${classroomId}/review`);
  return { ok: true };
}

export async function rejectReviewQuestion(questionId: string, classroomId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('lesson_questions')
    .update({ review_status: 'rejected', is_backup: true })
    .eq('id', questionId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/classrooms/${classroomId}/review`);
  return { ok: true };
}
