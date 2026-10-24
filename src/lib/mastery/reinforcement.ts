// Refuerzo dirigido desde el dominio de la clase: para un modulo, que estudiantes necesitan repaso y sobre que conceptos.
// Funciones puras (sin red), para poder probarlas. Las acciones de servidor las usan y hacen la lectura/escritura.

import { moduleMastery, type AttemptLite } from './mastery';

export const MAX_CONCEPTS_PER_PLAN = 3;

export interface ConceptAttempt extends AttemptLite {
  concept_tag?: string | null;
}

export function conceptLabel(tag: string): string {
  const s = tag.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Conceptos en los que el estudiante esta flojo EN ESTE MODULO: los de las preguntas cuya ULTIMA respuesta fue incorrecta (mismo
// criterio que el dominio: si fallo antes y luego acerto, ya no cuenta). Primero los que mas preguntas falladas tienen; en
// empate, el que fallo mas recientemente. Las preguntas sin concepto no sirven para dirigir un refuerzo.
export function weakConcepts(attempts: ConceptAttempt[], limit: number = MAX_CONCEPTS_PER_PLAN): string[] {
  const last = new Map<string, ConceptAttempt>();
  for (const a of attempts) {
    const prev = last.get(a.question_id);
    if (!prev || Date.parse(a.attempted_at) > Date.parse(prev.attempted_at)) last.set(a.question_id, a);
  }
  const stats = new Map<string, { failed: number; latest: number }>();
  for (const a of Array.from(last.values())) {
    const tag = a.concept_tag?.trim();
    if (a.was_correct || !tag) continue;
    const s = stats.get(tag) ?? { failed: 0, latest: 0 };
    s.failed += 1;
    s.latest = Math.max(s.latest, Date.parse(a.attempted_at));
    stats.set(tag, s);
  }
  return Array.from(stats.entries())
    .sort((x, y) => y[1].failed - x[1].failed || y[1].latest - x[1].latest)
    .slice(0, limit)
    .map(([tag]) => tag);
}

export interface ReinforcementAssignment {
  studentId: string;
  name: string;
  concepts: string[];
}

export interface ReinforcementSkip {
  studentId: string;
  name: string;
  reason: 'active_plan' | 'no_concepts';
}

export interface ReinforcementPlanResult {
  assignments: ReinforcementAssignment[];
  skipped: ReinforcementSkip[];
}

// A quien se le asigna: estudiantes cuyo dominio del modulo es "por repasar". Se omite (y se dice por que) a quien ya tiene
// un plan activo —no se le apila otro— y a quien no tiene conceptos identificables.
export function planReinforcement(input: {
  students: { id: string; name: string }[];
  attemptsByStudent: Map<string, ConceptAttempt[]>;
  activePlanStudentIds: Set<string>;
}): ReinforcementPlanResult {
  const assignments: ReinforcementAssignment[] = [];
  const skipped: ReinforcementSkip[] = [];
  for (const s of input.students) {
    const attempts = input.attemptsByStudent.get(s.id) ?? [];
    if (moduleMastery(attempts).state !== 'needs_review') continue;
    if (input.activePlanStudentIds.has(s.id)) {
      skipped.push({ studentId: s.id, name: s.name, reason: 'active_plan' });
      continue;
    }
    const concepts = weakConcepts(attempts);
    if (concepts.length === 0) skipped.push({ studentId: s.id, name: s.name, reason: 'no_concepts' });
    else assignments.push({ studentId: s.id, name: s.name, concepts });
  }
  return { assignments, skipped };
}

// Modulo del que se deben sacar las preguntas de un plan: el que mas conceptos del plan registra (classroom_concepts). null si
// ninguno los registra (el llamador usa su respaldo de siempre). En empate gana el primero que aparece, para ser estable.
export function pickAnchorModule(concepts: string[], rows: { module_id: string; tag: string }[]): string | null {
  const wanted = new Set(concepts);
  const counts = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!wanted.has(r.tag)) continue;
    const set = counts.get(r.module_id) ?? new Set<string>();
    set.add(r.tag);
    counts.set(r.module_id, set);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [moduleId, tags] of Array.from(counts.entries())) {
    if (tags.size > bestN) {
      best = moduleId;
      bestN = tags.size;
    }
  }
  return best;
}
