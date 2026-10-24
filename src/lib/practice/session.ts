// Modo practica: elige QUE preguntas practica un estudiante y en que orden. Funciones puras (sin red), para poder probarlas.
//
// Regla de oro: solo se practican preguntas que el estudiante YA cerro en una leccion (tiene un intento en question_attempts,
// que se escribe al cerrarlas, cuando ya se le revelo la respuesta). Asi la practica nunca muestra la clave de una pregunta
// que todavia no ha respondido: no sirve para memorizar la evaluacion antes de hacerla.

import { isValidQuestion } from '@/lib/lesson/validateQuestion';

export const PRACTICE_SIZE = 12;

export interface AttemptRow {
  question_id: string;
  was_correct: boolean;
  attempted_at: string;
}

export interface PracticeQueue {
  ids: string[];
  // Preguntas distintas que el estudiante ha respondido en la clase.
  answeredTotal: number;
  // De esas, las que fallo la ULTIMA vez que las respondio.
  wrongTotal: number;
}

function shuffled<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Prioridad: primero lo que fallo la ultima vez (practica de recuperacion sobre lo que mas hace falta), mezclado; luego lo
// que acerto, empezando por lo que hace MAS tiempo que no ve. Cuenta el ultimo intento de cada pregunta.
export function buildPracticeQueue(attempts: AttemptRow[], opts: { size?: number; rng?: () => number } = {}): PracticeQueue {
  const size = opts.size ?? PRACTICE_SIZE;
  const rng = opts.rng ?? Math.random;
  const last = new Map<string, AttemptRow>();
  for (const a of attempts) {
    const prev = last.get(a.question_id);
    if (!prev || Date.parse(a.attempted_at) > Date.parse(prev.attempted_at)) last.set(a.question_id, a);
  }
  const all = Array.from(last.values());
  const wrong = all.filter((a) => !a.was_correct);
  const right = all.filter((a) => a.was_correct).sort((a, b) => Date.parse(a.attempted_at) - Date.parse(b.attempted_at));
  const ids = [...shuffled(wrong, rng), ...right].slice(0, size).map((a) => a.question_id);
  return { ids, answeredTotal: all.length, wrongTotal: wrong.length };
}

export type PracticeType = 'multiple_choice' | 'true_false' | 'fill_blank' | 'short_answer' | 'match';
const PRACTICE_TYPES: readonly string[] = ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match'];

// Pregunta lista para practicar: CON clave (ya la vio al cerrarla), porque se comprueba en el navegador sin guardar nada.
export interface PracticeQuestion {
  id: string;
  type: PracticeType;
  q: string;
  opts?: string[];
  ok?: number | boolean;
  answers?: string[];
  pairs?: { term: string; def: string }[];
  keywords?: string[];
  exp?: string | null;
}

const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);

// null = fila que no sirve (tipo de minijuego, campos faltantes...). Reutiliza la validacion de las lecciones.
export function toPracticeQuestion(row: any): PracticeQuestion | null {
  if (!row || typeof row.id !== 'string' || !PRACTICE_TYPES.includes(row.type)) return null;
  if (!isValidQuestion({ ...row, serverGraded: false }).valid) return null;
  const pairs = Array.isArray(row.pairs)
    ? row.pairs.filter((p: any) => p && typeof p.term === 'string' && typeof p.def === 'string').map((p: any) => ({ term: p.term, def: p.def }))
    : undefined;
  if (row.type === 'match' && (!pairs || pairs.length < 2)) return null;
  return {
    id: row.id,
    type: row.type,
    q: String(row.q),
    opts: strings(row.opts),
    ok: typeof row.ok === 'number' || typeof row.ok === 'boolean' ? row.ok : undefined,
    answers: strings(row.answers),
    pairs,
    keywords: strings(row.keywords),
    exp: typeof row.exp === 'string' && row.exp.trim() ? row.exp : null,
  };
}
