// Que muestra la pantalla de revision del profesor como "la respuesta correcta"
// de cada pregunta clasica.
//
// Por que existe: la tarjeta de /teacher/classrooms/[id]/review mostraba solo el
// enunciado, las opciones y las respuestas de fill_blank. Ocultaba el contenido
// que hay que juzgar en 4 de los 5 tipos: los PARES de match, la respuesta
// esperada (keywords) de short_answer, cual opcion es la correcta (ok) en
// multiple_choice y si la afirmacion esta marcada verdadera o falsa (ok) en
// true_false. Medido sobre la cola real: 31 de 37 preguntas clasicas no se
// podian juzgar en lo esencial -- "¿la respuesta correcta es realmente correcta?".
// Etiquetar asi habria metido ruido justo en la verdad de referencia con la que
// se mide al juez IA.
//
// Los datos ya estaban en la fila (la pagina hace select('*')): faltaba mostrarlos.

export type AnswerView =
  | { kind: 'options'; options: { text: string; correct: boolean }[]; hasCorrect: boolean }
  | { kind: 'true_false'; value: boolean }
  | { kind: 'pairs'; pairs: { term: string; def: string }[] }
  | { kind: 'keywords'; keywords: string[] }
  | { kind: 'blank'; answers: string[] }
  // El tipo exige una respuesta y la fila no la trae: ya es motivo para rechazar.
  | { kind: 'missing' }
  // Minijuego o tipo desconocido: su contenido va en game_data, se muestra aparte.
  | { kind: 'none' };

interface QuestionLike {
  type: string;
  opts?: unknown;
  ok?: unknown;
  answers?: unknown;
  pairs?: unknown;
  keywords?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

export function buildAnswerView(q: QuestionLike): AnswerView {
  switch (q.type) {
    case 'multiple_choice': {
      const opts = strings(q.opts);
      if (opts.length === 0) return { kind: 'missing' };
      // ok es el INDICE de la opcion correcta (ver isValidQuestion).
      const ok = typeof q.ok === 'number' && Number.isInteger(q.ok) && q.ok >= 0 && q.ok < opts.length ? q.ok : -1;
      return {
        kind: 'options',
        options: opts.map((text, i) => ({ text, correct: i === ok })),
        hasCorrect: ok !== -1,
      };
    }

    case 'true_false':
      return typeof q.ok === 'boolean' ? { kind: 'true_false', value: q.ok } : { kind: 'missing' };

    case 'match': {
      const pairs = (Array.isArray(q.pairs) ? q.pairs : [])
        .filter((p: any) => p && typeof p.term === 'string' && typeof p.def === 'string')
        .map((p: any) => ({ term: p.term as string, def: p.def as string }));
      return pairs.length > 0 ? { kind: 'pairs', pairs } : { kind: 'missing' };
    }

    case 'short_answer': {
      const keywords = strings(q.keywords);
      return keywords.length > 0 ? { kind: 'keywords', keywords } : { kind: 'missing' };
    }

    case 'fill_blank': {
      const answers = strings(q.answers);
      return answers.length > 0 ? { kind: 'blank', answers } : { kind: 'missing' };
    }

    default:
      return { kind: 'none' };
  }
}
