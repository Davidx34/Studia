import { normalizeAnswer } from '@/lib/lesson/normalize';

// Calificacion de una respuesta, como funcion PURA (sin base de datos ni red), para poder probarla y reutilizarla.
// Hoy solo la usa el "modo sombra" (/api/lesson/shadow): el navegador sigue calificando y el servidor compara.
// Cuando la paridad sea suficiente, esta misma funcion pasa a ser la que decide (fase 1 del plan de calificacion).
//
// IMPORTANTE: replica a proposito las reglas que hoy aplica el navegador (lesson/[id]/page.tsx), incluida la de
// "la respuesta contiene la palabra" (includes) en fill_blank y short_answer. Mejorarlas se hace DESPUES de medir.

export interface QuestionKey {
  type: string;
  ok?: unknown;
  answers?: unknown;
  pairs?: unknown;
  keywords?: unknown;
}

export type GradeResult =
  | { status: 'graded'; correct: boolean }
  | { status: 'unsupported' } // tipo que aun no se verifica en el servidor (minijuegos)
  | { status: 'invalid' }; // la respuesta enviada no tiene la forma esperada

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function allContained(text: string, expected: string[]): boolean {
  if (expected.length === 0) return false; // sin claves no se puede afirmar nada: no puntua
  const norm = normalizeAnswer(text);
  return expected.every((e) => norm.includes(normalizeAnswer(e)));
}

// `answer` es lo que el estudiante dio: { selectedIndex } | { selected } | { text } | { pairing }.
export function gradeAnswer(key: QuestionKey, answer: unknown): GradeResult {
  const a = answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : null;

  switch (key.type) {
    case 'multiple_choice':
      if (!a || typeof a.selectedIndex !== 'number' || typeof key.ok !== 'number') return { status: 'invalid' };
      return { status: 'graded', correct: a.selectedIndex === key.ok };

    case 'true_false':
      if (!a || typeof a.selected !== 'boolean' || typeof key.ok !== 'boolean') return { status: 'invalid' };
      return { status: 'graded', correct: a.selected === key.ok };

    case 'fill_blank':
      if (!a || typeof a.text !== 'string') return { status: 'invalid' };
      return { status: 'graded', correct: allContained(a.text, strings(key.answers)) };

    case 'short_answer':
      if (!a || typeof a.text !== 'string') return { status: 'invalid' };
      return { status: 'graded', correct: allContained(a.text, strings(key.keywords)) };

    case 'match': {
      // pairing[i] = indice del par cuya definicion eligio el estudiante para el termino i (-1 = sin conectar).
      const pairs = Array.isArray(key.pairs) ? key.pairs : [];
      if (!a || !Array.isArray(a.pairing) || a.pairing.length !== pairs.length || pairs.length === 0) return { status: 'invalid' };
      if (!a.pairing.every((n) => typeof n === 'number' && Number.isInteger(n))) return { status: 'invalid' };
      return { status: 'graded', correct: a.pairing.every((n, i) => n === i) };
    }

    default:
      return { status: 'unsupported' };
  }
}
