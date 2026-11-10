'use server';

// Acciones del profesor sobre el cuaderno de estilo de su clase (fase 3 de «IA que aprende»). Todo pasa por la RLS de ai_playbooks (solo el profesor dueno de la clase).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { sanitizeRules, MAX_RULES } from '@/lib/aiLearning/playbook';
import { mergeRules } from '@/lib/aiLearning/carryOver';
import { createMergedDraft } from '@/lib/aiLearning/playbookDraft';
import { MIN_TOTAL_REASONS, proposeRules } from '@/lib/aiLearning/ruleProposals';

export interface PlaybookActionResult {
  ok: boolean;
  error?: string;
}

async function requireUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  // ai_playbooks aun no esta en los tipos generados de la base: se usa el cliente sin tipar hasta regenerarlos.
  return { supabase, user };
}

/** Guarda las reglas como una version NUEVA en borrador (nunca edita una version existente: el historial queda). */
export async function savePlaybookDraft(classroomId: string, rules: unknown, note?: string): Promise<PlaybookActionResult & { version?: number }> {
  const { supabase } = await requireUser();
  const clean = sanitizeRules(rules);
  if (clean.length === 0) return { ok: false, error: 'Escribe al menos una regla (mínimo 8 caracteres).' };
  if (Array.isArray(rules) && rules.length > MAX_RULES) return { ok: false, error: `Máximo ${MAX_RULES} reglas.` };
  const { data: last } = await (supabase as any).from('ai_playbooks').select('version').eq('classroom_id', classroomId).order('version', { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const { error } = await (supabase as any)
    .from('ai_playbooks')
    .insert({ classroom_id: classroomId, version, status: 'draft', origin: 'teacher', rules: clean, note: note?.trim().slice(0, 300) || null });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/classrooms/${classroomId}/playbook`);
  return { ok: true, version };
}

/** Activa una version (la anterior activa pasa a 'retired'). Activar una version vieja = volver atras. */
export async function activatePlaybook(classroomId: string, playbookId: string): Promise<PlaybookActionResult> {
  const { supabase } = await requireUser();
  const { data: target } = await (supabase as any).from('ai_playbooks').select('id').eq('id', playbookId).eq('classroom_id', classroomId).maybeSingle();
  if (!target) return { ok: false, error: 'Versión no encontrada.' };
  const { error: e1 } = await (supabase as any).from('ai_playbooks').update({ status: 'retired' }).eq('classroom_id', classroomId).eq('status', 'active');
  if (e1) return { ok: false, error: e1.message };
  const { error: e2 } = await (supabase as any).from('ai_playbooks').update({ status: 'active', activated_at: new Date().toISOString() }).eq('id', playbookId);
  if (e2) return { ok: false, error: e2.message };
  revalidatePath(`/teacher/classrooms/${classroomId}/playbook`);
  return { ok: true };
}

/** Desactiva el playbook activo: la generacion vuelve a funcionar exactamente como antes. */
export async function deactivatePlaybook(classroomId: string): Promise<PlaybookActionResult> {
  const { supabase } = await requireUser();
  const { error } = await (supabase as any).from('ai_playbooks').update({ status: 'retired' }).eq('classroom_id', classroomId).eq('status', 'active');
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/classrooms/${classroomId}/playbook`);
  return { ok: true };
}

/**
 * Trae al cuaderno de ESTA clase las reglas de otra clase del MISMO profesor (fase 6). Entra como borrador nuevo: las reglas actuales mandan, sin duplicados, tope de 10.
 * La RLS de ai_playbooks solo deja leer clases del propio profesor; aqui ademas se comprueba que el origen no sea esta misma clase.
 */
export async function importPlaybook(targetClassroomId: string, sourcePlaybookId: string): Promise<PlaybookActionResult & { added?: number; skipped?: number }> {
  const { supabase } = await requireUser();
  const db = supabase as any;
  const { data: src } = await db.from('ai_playbooks').select('id, classroom_id, version, rules').eq('id', sourcePlaybookId).maybeSingle();
  if (!src) return { ok: false, error: 'No se encontró el cuaderno de origen.' };
  if (src.classroom_id === targetClassroomId) return { ok: false, error: 'El origen es esta misma clase.' };
  const { data: own } = await db.from('classrooms').select('id').eq('id', targetClassroomId).maybeSingle();
  if (!own) return { ok: false, error: 'Clase no encontrada.' };
  const { data: current } = await db.from('ai_playbooks').select('rules').eq('classroom_id', targetClassroomId).eq('status', 'active').maybeSingle();
  const merged = mergeRules(current?.rules ?? [], src.rules);
  if (merged.added === 0) return { ok: false, error: 'No hay reglas nuevas para importar (ya están en tu cuaderno o llegaste al máximo de 10).' };
  const { data: last } = await db.from('ai_playbooks').select('version').eq('classroom_id', targetClassroomId).order('version', { ascending: false }).limit(1).maybeSingle();
  const { error } = await db
    .from('ai_playbooks')
    .insert({ classroom_id: targetClassroomId, version: (last?.version ?? 0) + 1, status: 'draft', origin: 'teacher', rules: merged.rules, note: `Importado de otra clase (versión ${src.version})` });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/classrooms/${targetClassroomId}/playbook`);
  return { ok: true, added: merged.added, skipped: merged.skipped };
}

/**
 * Flecha «rechazos -> reglas»: analiza los motivos de rechazo o revision de TUS preguntas, y si una categoria de error del generador se repite lo bastante, agrega al cuaderno como BORRADOR
 * (origen «ai») la plantilla curada correspondiente, con su evidencia. Nunca activa nada. Sin datos suficientes responde que no hay y no propone.
 */
export async function proposeRulesFromRejections(classroomId: string): Promise<PlaybookActionResult & { added?: number; analyzed?: number }> {
  const { supabase, user } = await requireUser();
  const db = supabase as any;
  const { data: own } = await db.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
  if (!own) return { ok: false, error: 'Clase no encontrada.' };
  const { data: mods } = await db.from('content_modules').select('id').eq('classroom_id', classroomId);
  const moduleIds: string[] = (mods ?? []).map((m: any) => m.id);
  if (moduleIds.length === 0) return { ok: false, error: 'La clase aún no tiene módulos.' };

  const reasons: (string | null)[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await db.from('lesson_questions').select('review_reason').in('module_id', moduleIds).in('review_status', ['rejected', 'human_review']).range(from, from + 999);
    if (error) return { ok: false, error: error.message };
    reasons.push(...(data ?? []).map((r: any) => r.review_reason as string | null));
    if ((data?.length ?? 0) < 1000) break;
  }
  const { data: active } = await db.from('ai_playbooks').select('rules').eq('classroom_id', classroomId).eq('status', 'active').maybeSingle();
  const result = proposeRules(reasons, sanitizeRules(active?.rules ?? []));
  if (result.insufficient) return { ok: false, analyzed: result.total, error: `No hay datos suficientes: se analizaron ${result.total} motivos y se necesitan al menos ${MIN_TOTAL_REASONS}.` };
  if (result.proposals.length === 0) return { ok: false, analyzed: result.total, error: 'Ningún error del generador se repite lo bastante para proponer una regla (o las reglas ya están en tu cuaderno).' };

  const draft = await createMergedDraft(db, classroomId, result.proposals.map((p) => p.rule), `Propuesta de la IA a partir de ${result.total} rechazos o revisiones. Pendiente de tu revisión; no está activa.`, 'ai');
  if (!draft.ok) return { ok: false, error: draft.error };
  revalidatePath(`/teacher/classrooms/${classroomId}/playbook`);
  return { ok: true, added: draft.added, analyzed: result.total };
}
