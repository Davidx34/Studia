import { hasServiceRoleKey } from '@/lib/supabase/admin';

// Calificacion en el servidor de las preguntas clasicas (fase 1 del plan docs/PLAN_CALIFICACION_EN_SERVIDOR.md).
// Las respuestas correctas y la explicacion NO viajan al navegador al servir la leccion: llegan DESPUES de responder.

// Interruptor doble: hace falta pedirlo (SERVER_GRADING=on) y poder escribir con la llave de servicio.
// Cualquier otro caso deja la leccion como antes (el navegador califica).
export function serverGradingEnabled(): boolean {
  return process.env.SERVER_GRADING === 'on' && hasServiceRoleKey();
}

export const SERVER_GRADED_TYPES = ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match'] as const;
export const isServerGradedType = (t: unknown): boolean => typeof t === 'string' && (SERVER_GRADED_TYPES as readonly string[]).includes(t);

// Intentos por pregunta (los mismos que ya daba la interfaz: completar 2, emparejar 3, el resto 1).
export const MAX_TRIES: Record<string, number> = { multiple_choice: 1, true_false: 1, short_answer: 1, fill_blank: 2, match: 3 };

export function isFinalTry(type: string, triesUsed: number, correct: boolean): boolean {
  return correct || triesUsed >= (MAX_TRIES[type] ?? 1);
}

export function shuffleWith<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Version de una pregunta clasica SIN claves ni explicacion, para el navegador.
// match: los terminos y las definiciones viajan por separado y las definiciones mezcladas (el orden de `pairs`
// ya diria cual va con cual).
export function sanitizeQuestion(q: any, rng: () => number = Math.random): any {
  if (!q?.id || !isServerGradedType(q.type)) return q;
  const { ok, answers, keywords, pairs, exp, ...rest } = q;
  const safe: any = { ...rest, serverGraded: true };
  if (q.type === 'match') {
    const list: { term: string; def: string }[] = Array.isArray(pairs) ? pairs : [];
    const defs = list.map((p) => p.def);
    let mixed = shuffleWith(defs, rng);
    // Con 2+ pares evita que la mezcla deje todo en su sitio por azar.
    for (let i = 0; i < 5 && list.length > 1 && mixed.every((d, k) => d === defs[k]); i++) mixed = shuffleWith(defs, rng);
    safe.terms = list.map((p) => p.term);
    safe.defs = mixed;
  }
  return safe;
}

// Lo que se revela al cerrar una pregunta (acierto o ultimo intento).
export function buildReveal(key: { type: string; ok?: unknown; answers?: unknown; pairs?: unknown; keywords?: unknown }) {
  switch (key.type) {
    case 'multiple_choice':
    case 'true_false':
      return { ok: key.ok };
    case 'fill_blank':
      return { answers: key.answers };
    case 'short_answer':
      return { keywords: key.keywords };
    case 'match':
      return { defs: (Array.isArray(key.pairs) ? key.pairs : []).map((p: any) => p?.def) };
    default:
      return {};
  }
}
