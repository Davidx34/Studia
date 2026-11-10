// Flecha «estadisticas de estudiantes -> banderas»: preguntas con suficientes respuestas reales que casi nadie acierta (posible error en la pregunta o fuera del material) o que casi todos aciertan (no distinguen
// a quien domina de quien no). Solo SENALA para que el profesor decida; nunca retira nada por si sola.

export const MIN_ATTEMPTS = 10;
export const TOO_HARD = 0.2;
export const TOO_EASY = 0.95;

export interface StatRow {
  question_id: string;
  attempts: number;
  correct: number;
  correct_rate: number | string;
  distinct_students: number;
}

export type FlagKind = 'muy_dificil' | 'muy_facil';

export interface QuestionFlag {
  questionId: string;
  kind: FlagKind;
  attempts: number;
  rate: number;
  students: number;
  reason: string;
}

export interface FlagResult {
  flags: QuestionFlag[];
  /** Preguntas con estadisticas pero todavia sin muestra suficiente (no se concluye nada de ellas). */
  belowMinimum: number;
  total: number;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function flagQuestions(rows: StatRow[]): FlagResult {
  const flags: QuestionFlag[] = [];
  let below = 0;
  for (const r of rows) {
    if (r.attempts < MIN_ATTEMPTS) {
      below++;
      continue;
    }
    const rate = Number(r.correct_rate);
    if (rate < TOO_HARD) flags.push({ questionId: r.question_id, kind: 'muy_dificil', attempts: r.attempts, rate, students: r.distinct_students, reason: `Solo ${pct(rate)} acierta (${r.attempts} respuestas de ${r.distinct_students} estudiantes): puede estar mal formulada o fuera del material.` });
    else if (rate > TOO_EASY) flags.push({ questionId: r.question_id, kind: 'muy_facil', attempts: r.attempts, rate, students: r.distinct_students, reason: `${pct(rate)} acierta (${r.attempts} respuestas de ${r.distinct_students} estudiantes): no distingue a quien domina de quien no.` });
  }
  flags.sort((a, b) => (a.kind === b.kind ? b.attempts - a.attempts : a.kind === 'muy_dificil' ? -1 : 1));
  return { flags, belowMinimum: below, total: rows.length };
}
