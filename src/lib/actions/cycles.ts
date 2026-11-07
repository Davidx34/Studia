'use server';

// Cierre de ciclo y retrospectiva (fase 4 de «IA que aprende»). El profesor cierra el ciclo; se junta la actividad del periodo con la llave de servicio (varias tablas son solo de servidor)
// SOLO despues de comprobar que la clase es suya, y se guarda la instantanea + retrospectiva con su propio cliente (la RLS lo vuelve a comprobar).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import { buildRetrospective, buildSnapshot, type CycleInput, type SuggestionStatus } from '@/lib/aiLearning/retrospective';
import type { FeedbackEvent } from '@/lib/aiLearning/judgeCalibration';

export interface CycleActionResult {
  ok: boolean;
  error?: string;
}

const PAGE = 1000;
const MAX_ROWS = 50000;

// PostgREST devuelve como mucho 1000 filas por peticion: se pagina hasta un tope. Si se alcanza el tope se avisa en vez de callar.
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function requireOwner(classroomId: string) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: own } = await supabase.from('classrooms').select('id, created_at').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
  return { supabase, own };
}

export async function closeCycle(classroomId: string, label: string): Promise<CycleActionResult> {
  const { supabase, own } = await requireOwner(classroomId);
  if (!own) return { ok: false, error: 'Clase no encontrada.' };
  const cleanLabel = label.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!cleanLabel) return { ok: false, error: 'Ponle un nombre al ciclo (por ejemplo 2027-I).' };
  if (!hasServiceRoleKey()) return { ok: false, error: 'Falta la llave de servicio en el servidor.' };

  try {
    const db = createAdminSupabase() as any;
    const { data: last } = await (supabase as any).from('course_cycles').select('period_end').eq('classroom_id', classroomId).order('period_end', { ascending: false }).limit(1).maybeSingle();
    const windowStart: string = last?.period_end ?? (own as any).created_at;
    const windowEnd = new Date().toISOString();

    const { data: modules } = await db.from('content_modules').select('id, title').eq('classroom_id', classroomId);
    const moduleIds: string[] = (modules ?? []).map((m: any) => m.id);

    const [lessons, attempts, questions, events] = await Promise.all([
      moduleIds.length
        ? fetchAll<any>((a, b) =>
            db.from('lesson_attempts').select('module_id, student_id, score_percent').in('module_id', moduleIds).eq('status', 'finished').gte('finished_at', windowStart).lte('finished_at', windowEnd).range(a, b),
          )
        : Promise.resolve({ rows: [], truncated: false }),
      fetchAll<any>((a, b) => db.from('question_attempts').select('question_id, concept_tag, was_correct, student_id').eq('classroom_id', classroomId).gte('attempted_at', windowStart).lte('attempted_at', windowEnd).range(a, b)),
      moduleIds.length ? fetchAll<any>((a, b) => db.from('lesson_questions').select('id, module_id, review_status').in('module_id', moduleIds).range(a, b)) : Promise.resolve({ rows: [], truncated: false }),
      fetchAll<any>((a, b) => db.from('ai_feedback_events').select('question_id, signal, verdict, reason, created_at').eq('classroom_id', classroomId).range(a, b)),
    ]);

    const input: CycleInput = {
      windowStart,
      windowEnd,
      modules: (modules ?? []) as any,
      finishedLessons: lessons.rows,
      questionAttempts: attempts.rows,
      questions: questions.rows,
      feedbackEvents: events.rows as FeedbackEvent[],
    };
    const snapshot = { ...buildSnapshot(input), truncated: lessons.truncated || attempts.truncated || questions.truncated || events.truncated };
    const retro = buildRetrospective(snapshot);

    const { data: cycle, error: e1 } = await (supabase as any)
      .from('course_cycles')
      .insert({ classroom_id: classroomId, label: cleanLabel, period_start: windowStart, period_end: windowEnd, snapshot })
      .select('id')
      .single();
    if (e1) return { ok: false, error: e1.message };
    const { error: e2 } = await (supabase as any).from('cycle_retrospectives').insert({ cycle_id: cycle.id, classroom_id: classroomId, findings: retro.findings, suggestions: retro.suggestions });
    if (e2) {
      // Sin retrospectiva el ciclo queda a medias: se deshace para poder reintentar.
      await (supabase as any).from('course_cycles').delete().eq('id', cycle.id);
      return { ok: false, error: e2.message };
    }
    revalidatePath(`/teacher/classrooms/${classroomId}/cycles`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo cerrar el ciclo.' };
  }
}

const STATUSES: SuggestionStatus[] = ['pending', 'accepted', 'rejected', 'postponed'];

/** El profesor acepta, rechaza o pospone una sugerencia. Lo rechazado tambien se guarda: es senal de lo que NO quiere. */
export async function setSuggestionStatus(classroomId: string, retrospectiveId: string, suggestionId: string, status: SuggestionStatus): Promise<CycleActionResult> {
  const { supabase, own } = await requireOwner(classroomId);
  if (!own) return { ok: false, error: 'Clase no encontrada.' };
  if (!STATUSES.includes(status)) return { ok: false, error: 'Estado no válido.' };
  const { data: row } = await (supabase as any).from('cycle_retrospectives').select('suggestions').eq('id', retrospectiveId).eq('classroom_id', classroomId).maybeSingle();
  if (!row) return { ok: false, error: 'Retrospectiva no encontrada.' };
  const list = (row.suggestions ?? []) as { id: string; status: string }[];
  if (!list.some((s) => s.id === suggestionId)) return { ok: false, error: 'Sugerencia no encontrada.' };
  const next = list.map((s) => (s.id === suggestionId ? { ...s, status } : s));
  const { error } = await (supabase as any).from('cycle_retrospectives').update({ suggestions: next }).eq('id', retrospectiveId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/classrooms/${classroomId}/cycles`);
  return { ok: true };
}
