// El BANCO de preguntas de examen (migracion 088): guardar las preguntas que escribio la IA, que el profesor las apruebe o rechace, y armar lo que usa composeExam. La base va INYECTADA (sin
// red) para poder probar la logica; las rutas solo comprueban sesion y propiedad de la clase.
//
// Reglas: una pregunta nueva nace SIEMPRE pendiente de revision; solo las APROBADAS por el profesor entran a un examen; "no juzgada" por el juez NO es lo mismo que aprobada; el contenido no se
// edita (para cambiar una pregunta se rechaza y se genera otra); las claves de calificacion no salen de aqui hacia el estudiante.

import type { PoolQuestion } from './exam';
import type { JudgeVerdict } from './examJudge';
import type { ExamQuestion } from './examQuestion';
import type { Blueprint } from './types';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type StoredVerdict = JudgeVerdict | 'not_judged';

export interface BankRow {
  id: string;
  outcome_id: string;
  node_id: string;
  type: string;
  q: string;
  opts: unknown;
  ok: unknown;
  answers: unknown;
  keywords: unknown;
  pairs: unknown;
  exp: string;
  source_material_id: string;
  source_chunk: number;
  source_quote: string;
  review_status: ReviewStatus;
  judge_verdict: StoredVerdict;
  judge_problems: unknown;
}

export type NewBankRow = Omit<BankRow, 'id' | 'review_status'>;

export interface BankDb {
  // Inserta lo nuevo y devuelve cuantas se guardaron y cuantas se saltaron por ser el mismo enunciado.
  insertQuestions(blueprintId: string, classroomId: string, rows: NewBankRow[]): Promise<{ inserted: number; duplicates: number }>;
  listQuestions(blueprintId: string): Promise<BankRow[]>;
  // Cambia la revision de UNA pregunta de ESA clase. false = no existe en esa clase.
  setReview(args: { classroomId: string; questionId: string; status: Exclude<ReviewStatus, 'pending'>; reviewerId: string; reviewedAt: string }): Promise<boolean>;
}

export interface GeneratedItem {
  question: ExamQuestion;
  // Lo que dijo el juez de sustento. Si no se juzgo: 'not_judged' (NO aprobada: queda para revision como cualquiera).
  verdict: StoredVerdict;
  problems: string[];
}

const MAX_PROBLEMS = 10;
const MAX_PROBLEM_CHARS = 300;

export function toRow(item: GeneratedItem): NewBankRow {
  const q = item.question;
  return {
    outcome_id: q.outcomeId,
    node_id: q.nodeId,
    type: q.type,
    q: q.q,
    opts: q.opts ?? null,
    ok: q.ok ?? null,
    answers: q.answers ?? null,
    keywords: q.keywords ?? null,
    pairs: q.pairs ?? null,
    exp: q.exp,
    source_material_id: q.source.materialId,
    source_chunk: q.source.chunkIndex,
    source_quote: q.source.quote,
    judge_verdict: item.verdict,
    judge_problems: item.problems.slice(0, MAX_PROBLEMS).map((p) => String(p).slice(0, MAX_PROBLEM_CHARS)),
  };
}

export async function saveGenerated(db: BankDb, ctx: { blueprintId: string; classroomId: string }, items: readonly GeneratedItem[]): Promise<{ inserted: number; duplicates: number }> {
  if (items.length === 0) return { inserted: 0, duplicates: 0 };
  return db.insertQuestions(ctx.blueprintId, ctx.classroomId, items.map(toRow));
}

export type ReviewResult = { ok: true; status: Exclude<ReviewStatus, 'pending'> } | { ok: false; status: 400 | 404; error: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El profesor aprueba o rechaza UNA pregunta. Lo que llega del navegador no es confiable: se valida el id y la decision; la base comprueba que la pregunta es de ESA clase.
export async function reviewQuestion(db: BankDb, ctx: { classroomId: string; reviewerId: string; now?: () => Date }, questionId: unknown, decision: unknown): Promise<ReviewResult> {
  if (typeof questionId !== 'string' || !UUID_RE.test(questionId)) return { ok: false, status: 400, error: 'La pregunta no es valida.' };
  if (decision !== 'approved' && decision !== 'rejected') return { ok: false, status: 400, error: 'La decision debe ser aprobar o rechazar.' };
  const found = await db.setReview({ classroomId: ctx.classroomId, questionId, status: decision, reviewerId: ctx.reviewerId, reviewedAt: (ctx.now?.() ?? new Date()).toISOString() });
  return found ? { ok: true, status: decision } : { ok: false, status: 404, error: 'Pregunta no encontrada.' };
}

// Lo que ve composeExam: SOLO ids y tipos de las preguntas APROBADAS (nunca contenido ni claves).
export function approvedPool(rows: readonly BankRow[]): PoolQuestion[] {
  return rows.filter((r) => r.review_status === 'approved').map((r) => ({ id: r.id, outcomeId: r.outcome_id, nodeId: r.node_id, type: r.type }));
}

export interface OutcomeBank {
  outcomeId: string;
  statement: string;
  approved: number;
  pending: number;
  rejected: number;
  // Preguntas que el juez dejo sin decidir o no juzgo y que estan pendientes (el profesor debe mirarlas con atencion).
  needAttention: number;
}

// Como va el banco por comprension: cuantas aprobadas, pendientes y rechazadas. Una comprension SIN aprobadas no se puede examinar.
export function bankSummary(plan: Blueprint, rows: readonly BankRow[]): { outcomes: OutcomeBank[]; uncovered: OutcomeBank[] } {
  const outcomes = plan.outcomes.map((o): OutcomeBank => {
    const mine = rows.filter((r) => r.outcome_id === o.id);
    return {
      outcomeId: o.id,
      statement: o.statement,
      approved: mine.filter((r) => r.review_status === 'approved').length,
      pending: mine.filter((r) => r.review_status === 'pending').length,
      rejected: mine.filter((r) => r.review_status === 'rejected').length,
      needAttention: mine.filter((r) => r.review_status === 'pending' && r.judge_verdict !== 'supported').length,
    };
  });
  return { outcomes, uncovered: outcomes.filter((o) => o.approved === 0) };
}
