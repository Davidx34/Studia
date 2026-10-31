import { normalizeAnswer } from '@/lib/lesson/normalize';

// Calificacion de una respuesta, como funcion PURA (sin base de datos ni red), para poder probarla y reutilizarla.
// La usan el "modo sombra" (/api/lesson/shadow) y la calificacion en el servidor (/api/lesson/answer).
//
// Replica a proposito las reglas que aplicaba el navegador (incluida la de "la respuesta contiene la palabra" en
// fill_blank y short_answer): la paridad se midio contra el navegador antes de apoyarse en esta funcion.

export interface QuestionKey {
  type: string;
  ok?: unknown;
  answers?: unknown;
  pairs?: unknown;
  keywords?: unknown;
}

export interface GradeDetail {
  matched?: number; // short_answer / fill_blank: cuantas palabras esperadas aparecieron
  total?: number;
  perTerm?: boolean[]; // match con definiciones: acierto por termino
  perSlot?: boolean[]; // linea del tiempo: acierto por posicion
}

export type GradeResult =
  | { status: 'graded'; correct: boolean; detail?: GradeDetail }
  | { status: 'unsupported' } // tipo que aun no se verifica en el servidor (minijuegos)
  | { status: 'invalid' }; // la respuesta enviada no tiene la forma esperada

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function contained(text: string, expected: string[]): { correct: boolean; matched: number; total: number } {
  const norm = normalizeAnswer(text);
  const matched = expected.filter((e) => norm.includes(normalizeAnswer(e))).length;
  // Sin claves no se puede afirmar nada: no puntua.
  return { correct: expected.length > 0 && matched === expected.length, matched, total: expected.length };
}

// `answer` es lo que el estudiante dio:
//   { selectedIndex } | { selected } | { text } | { pairing: number[] }  (indices; modo sombra)
//   | { defs: (string|null)[] }  (emparejar en el servidor: la definicion que conecto con cada termino)
export function gradeAnswer(key: QuestionKey, answer: unknown): GradeResult {
  const a = answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : null;

  switch (key.type) {
    case 'multiple_choice':
      if (!a || typeof a.selectedIndex !== 'number' || typeof key.ok !== 'number') return { status: 'invalid' };
      return { status: 'graded', correct: a.selectedIndex === key.ok };

    case 'true_false':
      if (!a || typeof a.selected !== 'boolean' || typeof key.ok !== 'boolean') return { status: 'invalid' };
      return { status: 'graded', correct: a.selected === key.ok };

    case 'fill_blank': {
      if (!a || typeof a.text !== 'string') return { status: 'invalid' };
      const r = contained(a.text, strings(key.answers));
      return { status: 'graded', correct: r.correct, detail: { matched: r.matched, total: r.total } };
    }

    case 'short_answer': {
      if (!a || typeof a.text !== 'string') return { status: 'invalid' };
      const r = contained(a.text, strings(key.keywords));
      return { status: 'graded', correct: r.correct, detail: { matched: r.matched, total: r.total } };
    }

    case 'match': {
      const pairs = Array.isArray(key.pairs) ? (key.pairs as { def?: unknown }[]) : [];
      if (!a || pairs.length === 0) return { status: 'invalid' };

      // Servidor: texto de la definicion conectada a cada termino (null = sin conectar).
      if (Array.isArray(a.defs)) {
        const given = a.defs as unknown[];
        if (given.length !== pairs.length) return { status: 'invalid' };
        if (!given.every((d) => d === null || typeof d === 'string')) return { status: 'invalid' };
        const perTerm = pairs.map((p, i) => typeof p?.def === 'string' && typeof given[i] === 'string' && (given[i] as string).trim() === p.def.trim());
        return { status: 'graded', correct: perTerm.every(Boolean), detail: { perTerm } };
      }

      // Modo sombra: pairing[i] = indice del par cuya definicion eligio el estudiante para el termino i (-1 = sin conectar).
      if (!Array.isArray(a.pairing) || a.pairing.length !== pairs.length) return { status: 'invalid' };
      if (!a.pairing.every((n) => typeof n === 'number' && Number.isInteger(n))) return { status: 'invalid' };
      return { status: 'graded', correct: a.pairing.every((n, i) => n === i) };
    }

    default:
      return { status: 'unsupported' };
  }
}
