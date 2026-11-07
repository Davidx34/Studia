// Fase 4 de «IA que aprende»: cierre de ciclo y retrospectiva.
//
// La retrospectiva se calcula con REGLAS sobre la instantanea (sin LLM): cada hallazgo cita su dato y su tamano de muestra, y con muestras pequenas dice «no hay datos suficientes» en vez de
// concluir. Asi no puede inventar causas. Un resumen en lenguaje natural con un LLM podria agregarse despues SIN cambiar estos hallazgos.
// La instantanea NO guarda identificadores de estudiantes ni texto de preguntas: solo conteos, tasas e ids de preguntas.

import { calibrateJudge, type Calibration, type FeedbackEvent } from './judgeCalibration';

export const MIN_MODULE_ATTEMPTS = 5;
export const MIN_ITEM_ATTEMPTS = 10;
export const WEAK_MODULE_AVG = 60;
export const WEAK_RATE = 0.5;
export const TOO_HARD_RATE = 0.2;
export const TOO_EASY_RATE = 0.95;
export const MAX_LISTED = 8;

export interface CycleInput {
  windowStart: string;
  windowEnd: string;
  modules: { id: string; title: string }[];
  finishedLessons: { module_id: string; student_id: string; score_percent: number | null }[];
  questionAttempts: { question_id: string; concept_tag: string | null; was_correct: boolean; student_id: string }[];
  questions: { id: string; module_id: string; review_status: string }[];
  feedbackEvents: FeedbackEvent[];
}

export interface Snapshot {
  windowStart: string;
  windowEnd: string;
  students: number;
  finishedLessons: number;
  questionAttempts: number;
  modules: { id: string; title: string; finished: number; students: number; avgScore: number | null }[];
  concepts: { tag: string; attempts: number; rate: number }[];
  questionBank: { total: number; approved: number; rejected: number; humanReview: number; pending: number };
  hardQuestions: { id: string; attempts: number; rate: number }[];
  easyQuestions: { id: string; attempts: number; rate: number }[];
  judge: Pick<Calibration, 'status' | 'decisive' | 'agree' | 'falsePass' | 'falseFail' | 'lowerBound'>;
}

export type SuggestionKind = 'reinforce_module' | 'reinforce_concept' | 'review_question' | 'review_judge' | 'review_pending' | 'collect_more_data';
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'postponed';

export interface Finding {
  id: string;
  kind: 'module' | 'concept' | 'question' | 'quality' | 'data';
  text: string;
  /** Dato exacto en que se apoya (cifras y tamano de muestra). */
  evidence: string;
  /** false = el dato no alcanza para concluir. */
  conclusive: boolean;
}

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  text: string;
  evidence: string;
  status: SuggestionStatus;
}

export interface Retrospective {
  findings: Finding[];
  suggestions: Suggestion[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (r: number) => `${Math.round(r * 100)} %`;

export function buildSnapshot(input: CycleInput): Snapshot {
  const students = new Set<string>();
  for (const l of input.finishedLessons) students.add(l.student_id);
  for (const a of input.questionAttempts) students.add(a.student_id);

  const modules = input.modules.map((m) => {
    const ls = input.finishedLessons.filter((l) => l.module_id === m.id);
    const scored = ls.filter((l) => l.score_percent !== null);
    return {
      id: m.id,
      title: m.title,
      finished: ls.length,
      students: new Set(ls.map((l) => l.student_id)).size,
      avgScore: scored.length ? round(scored.reduce((s, l) => s + (l.score_percent as number), 0) / scored.length, 1) : null,
    };
  });

  const byConcept = new Map<string, { n: number; ok: number }>();
  const byQuestion = new Map<string, { n: number; ok: number }>();
  for (const a of input.questionAttempts) {
    if (a.concept_tag) {
      const c = byConcept.get(a.concept_tag) ?? { n: 0, ok: 0 };
      c.n++;
      if (a.was_correct) c.ok++;
      byConcept.set(a.concept_tag, c);
    }
    const q = byQuestion.get(a.question_id) ?? { n: 0, ok: 0 };
    q.n++;
    if (a.was_correct) q.ok++;
    byQuestion.set(a.question_id, q);
  }
  const concepts = [...byConcept].map(([tag, v]) => ({ tag, attempts: v.n, rate: round(v.ok / v.n, 3) })).sort((a, b) => a.rate - b.rate || b.attempts - a.attempts).slice(0, 20);
  const stats = [...byQuestion].map(([id, v]) => ({ id, attempts: v.n, rate: round(v.ok / v.n, 3) })).filter((q) => q.attempts >= MIN_ITEM_ATTEMPTS);

  const count = (s: string) => input.questions.filter((q) => q.review_status === s).length;
  const cal = calibrateJudge(input.feedbackEvents);

  return {
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    students: students.size,
    finishedLessons: input.finishedLessons.length,
    questionAttempts: input.questionAttempts.length,
    modules,
    concepts,
    questionBank: { total: input.questions.length, approved: count('approved'), rejected: count('rejected'), humanReview: count('human_review'), pending: count('pending') },
    hardQuestions: stats.filter((q) => q.rate < TOO_HARD_RATE).sort((a, b) => a.rate - b.rate).slice(0, MAX_LISTED),
    easyQuestions: stats.filter((q) => q.rate > TOO_EASY_RATE).sort((a, b) => b.rate - a.rate).slice(0, MAX_LISTED),
    judge: { status: cal.status, decisive: cal.decisive, agree: cal.agree, falsePass: cal.falsePass, falseFail: cal.falseFail, lowerBound: cal.lowerBound },
  };
}

export function buildRetrospective(s: Snapshot): Retrospective {
  const findings: Finding[] = [];
  const suggestions: Suggestion[] = [];
  const add = (f: Finding, sug?: Omit<Suggestion, 'id' | 'status' | 'evidence'>) => {
    findings.push(f);
    if (sug) suggestions.push({ id: `s${suggestions.length + 1}`, status: 'pending', evidence: f.evidence, ...sug });
  };

  // Modulos con bajo rendimiento (solo con muestra minima).
  const enough = s.modules.filter((m) => m.finished >= MIN_MODULE_ATTEMPTS && m.avgScore !== null);
  const weakModules = enough.filter((m) => (m.avgScore as number) < WEAK_MODULE_AVG).sort((a, b) => (a.avgScore as number) - (b.avgScore as number));
  for (const m of weakModules.slice(0, MAX_LISTED)) {
    add(
      { id: `module-${m.id}`, kind: 'module', conclusive: true, text: `El módulo «${m.title}» tuvo bajo rendimiento.`, evidence: `Promedio ${m.avgScore} % en ${m.finished} lecciones terminadas por ${m.students} estudiantes.` },
      { kind: 'reinforce_module', text: `Revisa el material y las preguntas del módulo «${m.title}»; considera reforzarlo o reordenarlo.` },
    );
  }
  const thinModules = s.modules.filter((m) => m.finished > 0 && m.finished < MIN_MODULE_ATTEMPTS).length;

  // Conceptos con bajo acierto.
  const weakConcepts = s.concepts.filter((c) => c.attempts >= MIN_ITEM_ATTEMPTS && c.rate < WEAK_RATE);
  for (const c of weakConcepts.slice(0, MAX_LISTED)) {
    add(
      { id: `concept-${c.tag}`, kind: 'concept', conclusive: true, text: `El concepto «${c.tag}» se falla con frecuencia.`, evidence: `Acierto ${pct(c.rate)} en ${c.attempts} intentos.` },
      { kind: 'reinforce_concept', text: `Agrega explicación o práctica sobre «${c.tag}» antes de evaluarlo.` },
    );
  }

  // Preguntas demasiado dificiles o faciles (no discriminan).
  for (const q of s.hardQuestions) {
    add(
      { id: `hard-${q.id}`, kind: 'question', conclusive: true, text: 'Una pregunta casi nadie la acierta.', evidence: `Pregunta ${q.id.slice(0, 8)}: acierto ${pct(q.rate)} en ${q.attempts} intentos.` },
      { kind: 'review_question', text: `Revisa la pregunta ${q.id.slice(0, 8)}: puede estar mal formulada o fuera del material.` },
    );
  }
  if (s.easyQuestions.length) {
    add({ id: 'easy-questions', kind: 'question', conclusive: true, text: `${s.easyQuestions.length} pregunta(s) las acierta casi todo el mundo; no distinguen a quien domina de quien no.`, evidence: `Acierto > ${pct(TOO_EASY_RATE)} con ≥ ${MIN_ITEM_ATTEMPTS} intentos cada una.` });
  }

  // Calidad del banco y del juez.
  const qb = s.questionBank;
  if (qb.pending > 0 || qb.humanReview > 0) {
    add(
      { id: 'pending-review', kind: 'quality', conclusive: true, text: 'Hay preguntas sin resolver.', evidence: `${qb.pending} sin juzgar y ${qb.humanReview} esperando tu revisión (de ${qb.total}).` },
      { kind: 'review_pending', text: 'Resuelve la cola de revisión: cada decisión tuya también ayuda a calibrar al juez.' },
    );
  }
  if (s.judge.status === 'insufficient') {
    add(
      { id: 'judge-data', kind: 'quality', conclusive: false, text: 'No hay datos suficientes para medir al juez IA.', evidence: `${s.judge.decisive} comparaciones decisivas con tus decisiones (se necesitan 20).` },
      { kind: 'collect_more_data', text: 'Aprueba o rechaza más preguntas en la revisión para poder medir al juez.' },
    );
  } else if (s.judge.status === 'degraded') {
    add(
      { id: 'judge-degraded', kind: 'quality', conclusive: true, text: 'El juez IA no coincide lo suficiente con tus decisiones.', evidence: `Acuerdo ${s.judge.agree}/${s.judge.decisive}; el juez aprobó ${s.judge.falsePass} que rechazaste y rechazó ${s.judge.falseFail} que aprobaste.` },
      { kind: 'review_judge', text: 'Revisa manualmente lo que el juez aprueba hasta que su acuerdo con tus decisiones mejore.' },
    );
  }

  // Sin muestra suficiente para lo principal: decirlo, no concluir.
  if (s.finishedLessons === 0 && s.questionAttempts === 0) {
    add({ id: 'no-activity', kind: 'data', conclusive: false, text: 'No hubo actividad de estudiantes en este ciclo.', evidence: '0 lecciones terminadas y 0 respuestas en el período.' });
  } else if (weakModules.length === 0 && weakConcepts.length === 0 && s.hardQuestions.length === 0) {
    add({
      id: 'insufficient-or-fine',
      kind: 'data',
      conclusive: false,
      text: 'No hay datos suficientes para señalar problemas de rendimiento (o no se detectaron).',
      evidence: `${s.students} estudiantes, ${s.finishedLessons} lecciones terminadas, ${s.questionAttempts} respuestas; ${thinModules} módulo(s) con menos de ${MIN_MODULE_ATTEMPTS} lecciones terminadas.`,
    });
  }

  return { findings, suggestions };
}
