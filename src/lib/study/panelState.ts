// Estado del panel de generacion del profesor (logica pura, sin React): se prueba aparte.

import { STALE_GENERATING_MS } from './constants';

export type RawStatus = 'generating' | 'ready' | 'failed';

export interface JobRow {
  status: RawStatus;
  started_at: string | null;
  finished_at: string | null;
  card_count: number;
  error: string | null;
}

export type Phase = 'none' | 'queued' | 'running' | 'ready' | 'ready_with_notes' | 'failed' | 'interrupted';

export interface ChipState {
  phase: Phase;
  note: string | null; // aviso (si salio incompleto) o motivo del fallo
}

// Fase de UN tipo de material (fichas o infografias) de un material, a partir de la fila de la base de datos y de si
// el profesor lo tiene en cola en esta pantalla.
export function chipState(row: JobRow | null | undefined, queued: boolean, now: number): ChipState {
  if (queued && (!row || row.status !== 'generating')) return { phase: 'queued', note: null };
  if (!row) return { phase: 'none', note: null };
  if (row.status === 'generating') {
    const started = row.started_at ? new Date(row.started_at).getTime() : now;
    if (now - started > STALE_GENERATING_MS) return { phase: 'interrupted', note: 'La generación se interrumpió (se cortó por tiempo). Puedes reintentar.' };
    return { phase: 'running', note: null };
  }
  if (row.status === 'failed') return { phase: 'failed', note: row.error ?? 'No se pudo generar.' };
  return row.error ? { phase: 'ready_with_notes', note: row.error } : { phase: 'ready', note: null };
}

export function isActive(phase: Phase): boolean {
  return phase === 'queued' || phase === 'running';
}

export interface MaterialStudyStatus {
  cards: ChipState;
  infographics: ChipState;
}

// "Con material de estudio para los estudiantes" = tiene fichas/flashcards listas (lo que ven en Estudiar).
export function hasStudyContent(s: MaterialStudyStatus, fichas: number, flashcards: number): boolean {
  return (s.cards.phase === 'ready' || s.cards.phase === 'ready_with_notes') && fichas + flashcards > 0;
}

// Cuales materiales seleccionar con "Seleccionar pendientes": los que no tienen nada listo ni en curso.
export function pendingIds(items: { id: string; status: MaterialStudyStatus; fichas: number; flashcards: number }[]): string[] {
  return items.filter((i) => !hasStudyContent(i.status, i.fichas, i.flashcards) && !isActive(i.status.cards.phase) && !isActive(i.status.infographics.phase)).map((i) => i.id);
}

export interface Task {
  materialId: string;
  kind: 'cards' | 'infographics';
  force: boolean;
}

// Tareas de la cola: material x tipo elegido. Lo que ya estaba listo se regenera (force) solo porque el profesor lo
// selecciono a proposito; el panel le avisa antes.
export function buildQueue(
  selected: string[],
  kinds: { cards: boolean; infographics: boolean },
  status: (id: string) => MaterialStudyStatus
): Task[] {
  const tasks: Task[] = [];
  for (const id of selected) {
    const s = status(id);
    if (kinds.cards && !isActive(s.cards.phase)) tasks.push({ materialId: id, kind: 'cards', force: s.cards.phase === 'ready' || s.cards.phase === 'ready_with_notes' });
    if (kinds.infographics && !isActive(s.infographics.phase)) tasks.push({ materialId: id, kind: 'infographics', force: s.infographics.phase === 'ready' || s.infographics.phase === 'ready_with_notes' });
  }
  return tasks;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type NoticeTone = 'success' | 'warning' | 'error';

export interface Notice {
  id: number;
  tone: NoticeTone;
  text: string;
}

// Mensaje para el profesor cuando termina una tarea.
export function outcomeNotice(
  materialName: string,
  kind: 'cards' | 'infographics',
  row: JobRow,
  counts: { fichas: number; flashcards: number; infographics: number }
): Omit<Notice, 'id'> {
  const label = kind === 'cards' ? 'fichas y flashcards' : 'infografías';
  if (row.status === 'failed') return { tone: 'error', text: `“${materialName}” (${label}): ${row.error ?? 'No se pudo generar.'}` };
  if (kind === 'cards') {
    const done = `“${materialName}”: ${counts.fichas} ${counts.fichas === 1 ? 'ficha' : 'fichas'} y ${counts.flashcards} ${counts.flashcards === 1 ? 'flashcard' : 'flashcards'} listas.`;
    return row.error ? { tone: 'warning', text: `${done} Ojo: ${row.error}` } : { tone: 'success', text: done };
  }
  if (counts.infographics === 0) return { tone: 'warning', text: `“${materialName}”: sin infografías. ${row.error ?? ''}`.trim() };
  const done = `“${materialName}”: ${counts.infographics} ${counts.infographics === 1 ? 'infografía lista' : 'infografías listas'}.`;
  return row.error ? { tone: 'warning', text: `${done} Ojo: ${row.error}` } : { tone: 'success', text: done };
}

export function summarize(notices: Pick<Notice, 'tone'>[]): { ok: number; warn: number; err: number } {
  return {
    ok: notices.filter((n) => n.tone === 'success').length,
    warn: notices.filter((n) => n.tone === 'warning').length,
    err: notices.filter((n) => n.tone === 'error').length,
  };
}
