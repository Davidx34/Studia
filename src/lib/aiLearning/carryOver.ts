// Fase 6 de «IA que aprende»: memoria del profesor entre cursos.
// Al empezar otro ciclo o reabrir una materia, el profesor puede (1) traer a su cuaderno de estilo las reglas de otra de SUS clases y (2) ver como lista de tareas lo que acepto o pospuso en la
// ultima retrospectiva. Nada viaja entre profesores: solo se leen clases del mismo profesor (la RLS lo garantiza) y todo entra como BORRADOR que el profesor activa.

import { MAX_RULES, sanitizeRules, type PlaybookRule } from './playbook';
import type { Suggestion } from './retrospective';

export interface MergeResult {
  rules: PlaybookRule[];
  /** Reglas del origen que se agregaron realmente. */
  added: number;
  /** Reglas del origen que NO entraron (repetidas o por el tope de 10). */
  skipped: number;
}

/** Une las reglas existentes con las importadas: las existentes mandan, sin duplicados, tope de MAX_RULES. */
export function mergeRules(existing: unknown, imported: unknown): MergeResult {
  const base = sanitizeRules(existing);
  const incoming = sanitizeRules(imported);
  const merged = sanitizeRules([...base, ...incoming]);
  const baseKeys = new Set(base.map((r) => r.text.toLowerCase()));
  const added = merged.filter((r) => !baseKeys.has(r.text.toLowerCase())).length;
  return { rules: merged, added, skipped: incoming.length - added };
}

export interface RetroForCarry {
  label: string;
  suggestions: Suggestion[];
}

export interface CarryItem {
  text: string;
  evidence: string;
  status: 'accepted' | 'postponed';
  from: string;
}

/** Tareas del siguiente ciclo: lo aceptado y lo pospuesto de la retrospectiva MAS RECIENTE. Lo rechazado no se arrastra (el profesor dijo que no lo quiere). Recibe las retrospectivas de la mas nueva a la mas vieja. */
export function nextCycleChecklist(retros: RetroForCarry[]): CarryItem[] {
  const latest = retros[0];
  if (!latest) return [];
  return latest.suggestions
    .filter((s): s is Suggestion & { status: 'accepted' | 'postponed' } => s.status === 'accepted' || s.status === 'postponed')
    .map((s) => ({ text: s.text, evidence: s.evidence, status: s.status, from: latest.label }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'accepted' ? -1 : 1));
}

export const IMPORT_CAP = MAX_RULES;
