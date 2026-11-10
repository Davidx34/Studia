// Crea una version BORRADOR del cuaderno de estilo de una clase a partir de reglas nuevas (propuestas de la IA o traidas de una retrospectiva). Nunca activa nada: el profesor decide.
// Las reglas actuales (la version activa) mandan; sin duplicados; tope de MAX_RULES. Usa el cliente del PROFESOR: la RLS de ai_playbooks solo deja escribir en sus clases.

import { mergeRules } from './carryOver';
import type { PlaybookRule } from './playbook';

export type DraftResult = { ok: true; version: number; added: number; skipped: number } | { ok: false; error: string };

export async function createMergedDraft(db: any, classroomId: string, incoming: PlaybookRule[], note: string, origin: 'teacher' | 'ai'): Promise<DraftResult> {
  if (incoming.length === 0) return { ok: false, error: 'No hay reglas para agregar.' };
  const { data: current } = await db.from('ai_playbooks').select('rules').eq('classroom_id', classroomId).eq('status', 'active').maybeSingle();
  const merged = mergeRules(current?.rules ?? [], incoming);
  if (merged.added === 0) return { ok: false, error: 'Esas reglas ya están en tu cuaderno o llegaste al máximo de 10.' };
  const { data: last } = await db.from('ai_playbooks').select('version').eq('classroom_id', classroomId).order('version', { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const { error } = await db.from('ai_playbooks').insert({ classroom_id: classroomId, version, status: 'draft', origin, rules: merged.rules, note: note.slice(0, 300) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, version, added: merged.added, skipped: merged.skipped };
}
