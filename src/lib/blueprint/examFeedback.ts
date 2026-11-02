// Lo que ve el estudiante al terminar un examen (decision 3D): TODAS las preguntas, marcando cuales le quedaron bien y mal, y de cada una una explicacion de fondo, el corte en que se
// vio, el modulo y el material explicito en que se apoya (con la cita). Ademas, que modulos le conviene repasar. Codigo puro.
//
// Solo se muestra lo que se derivo del plan y del material: nunca las claves de calificacion (opciones correctas, respuestas, parejas): la explicacion ya dice POR QUE es la respuesta.
// Esa informacion es de un intento ya CERRADO (el servidor la entrega despues de calificar): durante el examen el estudiante no la recibe.

import { provenanceOf, type ChunkIndex, type ExamQuestion, type Provenance } from './examQuestion';
import type { Blueprint } from './types';

export interface ServedQuestion extends ExamQuestion {
  id: string;
}

export interface FeedbackItem {
  questionId: string;
  position: number; // 1, 2, 3... en el orden en que se sirvio
  correct: boolean;
  question: string;
  explanation: string;
  // Donde se vio y en que material se apoya. null si el plan o el material ya no permiten ubicarla (no se inventa nada).
  where: Provenance | null;
}

export interface ReviewTopic {
  periodId: string;
  periodName: string;
  nodeId: string;
  moduleTitle: string;
  wrong: number;
  total: number;
  outcomes: string[]; // comprensiones finales que fallo en ese modulo
}

export interface ExamFeedback {
  total: number;
  correct: number;
  scorePercent: number;
  items: FeedbackItem[];
  // Modulos con al menos una pregunta fallada, de mas a menos fallos (a igualdad, en el orden del plan).
  toReview: ReviewTopic[];
}

export function buildExamFeedback(args: { plan: Blueprint; chunks: ChunkIndex; questions: readonly ServedQuestion[]; results: ReadonlyMap<string, boolean> }): ExamFeedback {
  const { plan, chunks, questions, results } = args;
  const order = new Map<string, number>();
  plan.periods.slice().sort((a, b) => a.order - b.order).forEach((p) => p.objectives.forEach((ob) => ob.modules.slice().sort((a, b) => a.order - b.order).forEach((m) => order.set(m.id, order.size))));

  const items: FeedbackItem[] = questions.map((q, i) => ({
    questionId: q.id,
    position: i + 1,
    // Sin resultado del servidor, la pregunta NO cuenta como acertada.
    correct: results.get(q.id) === true,
    question: q.q,
    explanation: q.exp,
    where: provenanceOf(q, plan, chunks),
  }));

  const correct = items.filter((x) => x.correct).length;
  const topics = new Map<string, ReviewTopic>();
  for (const it of items) {
    if (!it.where) continue;
    const t = topics.get(it.where.nodeId) ?? { periodId: it.where.periodId, periodName: it.where.periodName, nodeId: it.where.nodeId, moduleTitle: it.where.moduleTitle, wrong: 0, total: 0, outcomes: [] };
    t.total++;
    if (!it.correct) {
      t.wrong++;
      if (!t.outcomes.includes(it.where.outcomeStatement)) t.outcomes.push(it.where.outcomeStatement);
    }
    topics.set(it.where.nodeId, t);
  }
  const toReview = Array.from(topics.values())
    .filter((t) => t.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0));

  return { total: items.length, correct, scorePercent: items.length === 0 ? 0 : Math.round((correct / items.length) * 10000) / 100, items, toReview };
}
