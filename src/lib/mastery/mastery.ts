// Dominio de un estudiante sobre un modulo (y, sumando modulos, sobre un objetivo de aprendizaje).
// Funciones puras (sin red), para poder probarlas.
//
// Por que existe: el puntaje de un modulo dice "cuanto saco una vez", no "que domina". Aqui se mide con la EVIDENCIA acumulada:
// de cada pregunta cuenta solo la ULTIMA vez que se respondio (si fallo antes y luego acerto, ya la domina), y con poca
// evidencia no se afirma nada.
//
// Los umbrales salen de datos reales (aula de 5to grado, 2026-10): una leccion sirve 5 preguntas distintas por modulo y el
// banco tiene ~10, asi que 5 preguntas = una leccion completa. Son PROVISIONALES: se afinan con mas uso. Por eso la interfaz
// muestra siempre el conteo ("4 de 5 bien") y no solo la etiqueta.

export type MasteryState = 'not_started' | 'in_progress' | 'mastered' | 'needs_review';

// Preguntas distintas que hay que haber respondido para poder hablar de dominio (una leccion completa).
export const MIN_EVIDENCE = 5;
// Proporcion de aciertos (en la ultima vez de cada pregunta) para considerar dominado un modulo.
export const MASTERY_THRESHOLD = 0.8;

export interface AttemptLite {
  question_id: string;
  was_correct: boolean;
  attempted_at: string;
}

export interface ModuleMastery {
  state: MasteryState;
  // Preguntas distintas respondidas y cuantas estan bien en su ultimo intento.
  answered: number;
  correct: number;
  // Proporcion de aciertos (0 a 1); null si no hay respuestas.
  ratio: number | null;
}

export function moduleMastery(attempts: AttemptLite[]): ModuleMastery {
  const last = new Map<string, AttemptLite>();
  for (const a of attempts) {
    const prev = last.get(a.question_id);
    if (!prev || Date.parse(a.attempted_at) > Date.parse(prev.attempted_at)) last.set(a.question_id, a);
  }
  const answered = last.size;
  if (answered === 0) return { state: 'not_started', answered: 0, correct: 0, ratio: null };
  const correct = Array.from(last.values()).filter((a) => a.was_correct).length;
  const ratio = correct / answered;
  if (answered < MIN_EVIDENCE) return { state: 'in_progress', answered, correct, ratio };
  return { state: ratio >= MASTERY_THRESHOLD ? 'mastered' : 'needs_review', answered, correct, ratio };
}

export function groupAttemptsByModule<T extends AttemptLite & { module_id: string }>(rows: T[]): Map<string, AttemptLite[]> {
  const out = new Map<string, AttemptLite[]>();
  for (const r of rows) {
    const list = out.get(r.module_id);
    const a = { question_id: r.question_id, was_correct: r.was_correct, attempted_at: r.attempted_at };
    if (list) list.push(a);
    else out.set(r.module_id, [a]);
  }
  return out;
}

export interface MasteryCounts {
  total: number;
  not_started: number;
  in_progress: number;
  mastered: number;
  needs_review: number;
}

export function rollupMastery(states: MasteryState[]): MasteryCounts {
  const c: MasteryCounts = { total: states.length, not_started: 0, in_progress: 0, mastered: 0, needs_review: 0 };
  for (const s of states) c[s] += 1;
  return c;
}

// Estado de un objetivo a partir de sus modulos: dominado solo si TODOS lo estan; por repasar si alguno lo necesita (es lo que
// el estudiante debe atender primero); sin empezar si ninguno ha empezado; si no, en progreso.
export function objectiveState(states: MasteryState[]): MasteryState {
  if (states.length === 0) return 'not_started';
  if (states.every((s) => s === 'not_started')) return 'not_started';
  if (states.every((s) => s === 'mastered')) return 'mastered';
  if (states.some((s) => s === 'needs_review')) return 'needs_review';
  return 'in_progress';
}

export const MASTERY_LABELS: Record<MasteryState, string> = {
  not_started: 'Sin empezar',
  in_progress: 'En progreso',
  mastered: 'Dominado',
  needs_review: 'Por repasar',
};

// Frase corta con el conteo real, para que la etiqueta nunca sea una caja negra.
export function masteryDetail(m: ModuleMastery): string {
  switch (m.state) {
    case 'not_started':
      return 'Aún no respondes preguntas de este módulo';
    case 'in_progress':
      return `${m.correct} de ${m.answered} bien · con ${MIN_EVIDENCE} preguntas medimos tu dominio`;
    case 'mastered':
      return `${m.correct} de ${m.answered} bien`;
    case 'needs_review':
      return `${m.correct} de ${m.answered} bien · repasa lo que te costó`;
  }
}
