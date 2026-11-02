// El formulario del examen del estudiante: que cuenta como contestado y como se arma lo que se envia al servidor. Codigo puro (la pantalla solo lo pinta).
//
// Cada respuesta tiene la forma que espera gradeSession: multiple_choice {selectedIndex} (la POSICION en lo que el estudiante vio), true_false {selected}, fill_blank / short_answer {text},
// match {defs} (el texto de la definicion conectada a cada termino, o null).

import type { PresentedQuestion } from './examSession';

export type Answer =
  | { selectedIndex: number }
  | { selected: boolean }
  | { text: string }
  | { defs: (string | null)[] };

export type FormState = Record<string, Answer | undefined>;

const trimmed = (s: string) => s.trim();

export function isAnswered(q: PresentedQuestion, a: Answer | undefined): boolean {
  if (!a) return false;
  switch (q.type) {
    case 'multiple_choice':
      return 'selectedIndex' in a && Number.isInteger(a.selectedIndex) && a.selectedIndex >= 0 && a.selectedIndex < (q.opts?.length ?? 0);
    case 'true_false':
      return 'selected' in a && typeof a.selected === 'boolean';
    case 'fill_blank':
    case 'short_answer':
      return 'text' in a && typeof a.text === 'string' && trimmed(a.text).length > 0;
    case 'match':
      // Contestada solo si TODOS los terminos tienen una definicion conectada.
      return 'defs' in a && Array.isArray(a.defs) && a.defs.length === (q.terms?.length ?? -1) && a.defs.every((d) => typeof d === 'string' && d.length > 0);
    default:
      return false;
  }
}

export const answeredCount = (questions: readonly PresentedQuestion[], state: FormState): number => questions.filter((q) => isAnswered(q, state[q.id])).length;

// Lo que se envia: solo las respuestas de preguntas del examen, con el texto recortado. Lo que no se contesto no se manda (el servidor lo cuenta como incorrecto).
export function buildPayload(questions: readonly PresentedQuestion[], state: FormState): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const q of questions) {
    const a = state[q.id];
    if (!a) continue;
    if ('text' in a) {
      const t = trimmed(a.text);
      if (t.length > 0) out[q.id] = { text: t };
    } else if (isAnswered(q, a)) out[q.id] = a;
    else if ('defs' in a && Array.isArray(a.defs) && q.type === 'match') out[q.id] = a; // emparejar a medias: lo conectado cuenta, lo demas no
  }
  return out;
}

// Un cambio de una respuesta, sin mutar el estado.
export const withAnswer = (state: FormState, id: string, a: Answer | undefined): FormState => ({ ...state, [id]: a });

// Emparejar: cambiar la definicion de UN termino (por posicion) conservando las demas.
export function withMatch(state: FormState, q: PresentedQuestion, termIndex: number, def: string | null): FormState {
  const n = q.terms?.length ?? 0;
  if (termIndex < 0 || termIndex >= n) return state;
  const current = state[q.id];
  const defs = current && 'defs' in current && current.defs.length === n ? [...current.defs] : Array.from({ length: n }, () => null as string | null);
  defs[termIndex] = def && def.length > 0 ? def : null;
  return withAnswer(state, q.id, { defs });
}

// Un borrador guardado (sessionStorage) puede venir alterado o de otra version: solo se aceptan respuestas con la forma de SU pregunta.
export function restoreDraft(raw: unknown, questions: readonly PresentedQuestion[]): FormState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: FormState = {};
  for (const q of questions) {
    if (!Object.prototype.hasOwnProperty.call(src, q.id)) continue;
    const a = src[q.id] as any;
    if (!a || typeof a !== 'object') continue;
    if (q.type === 'multiple_choice' && Number.isInteger(a.selectedIndex) && a.selectedIndex >= 0 && a.selectedIndex < (q.opts?.length ?? 0)) out[q.id] = { selectedIndex: a.selectedIndex };
    else if (q.type === 'true_false' && typeof a.selected === 'boolean') out[q.id] = { selected: a.selected };
    else if ((q.type === 'fill_blank' || q.type === 'short_answer') && typeof a.text === 'string') out[q.id] = { text: a.text.slice(0, 2000) };
    else if (q.type === 'match' && Array.isArray(a.defs) && a.defs.length === (q.terms?.length ?? -1) && a.defs.every((d: unknown) => d === null || (typeof d === 'string' && (q.defs ?? []).includes(d)))) out[q.id] = { defs: a.defs };
  }
  return out;
}
