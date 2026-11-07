'use server';

// Acciones del profesor sobre el cuaderno de estilo de su clase (fase 3 de «IA que aprende»). Todo pasa por la RLS de ai_playbooks (solo el profesor dueno de la clase).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { sanitizeRules, MAX_RULES } from '@/lib/aiLearning/playbook';

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
