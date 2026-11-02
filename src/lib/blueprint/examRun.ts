// Empezar, entregar y releer un examen. Codigo con la base INYECTADA (sin red), para probar cada regla sin base de datos. La ruta /api/exam solo comprueba la sesion y arma las dependencias.
//
// Reglas (docs/EVALUACIONES.md, «Sesion de examen»):
//   - Solo un ESTUDIANTE MATRICULADO de la clase, y solo sobre un plan PUBLICADO.
//   - La evaluacion de un corte exige haber dominado (100 %) sus modulos, y la final, todos los cortes (courseGate).
//   - Empezar sirve preguntas APROBADAS, sin claves (presentQuestion). Si ya hay una sesion abierta y vigente, se RETOMA (mismas preguntas, mismo barajado): recargar la pagina no da otro examen.
//   - Entregar califica contra lo que SE SIRVIO (gradeSession) y cierra de forma atomica (intento + sesion). La retroalimentacion (decision 3D) solo existe DESPUES de cerrar.
//   - Entregar dos veces no regala otro intento: la segunda devuelve la misma retroalimentacion.
// Los mensajes son para el estudiante: dicen que paso, nunca detalles del banco ni de la base.

import { examGate } from './courseGate';
import { parseBlueprint } from './parse';
import type { CourseData } from './studentData';
import type { BankRow } from './examBank';
import { buildExamFeedback, type ExamFeedback } from './examFeedback';
import { chunkKey, type ChunkIndex } from './examQuestion';
import { gradeSession, presentQuestion, servedFromRow, startExam, type PresentedQuestion, type SessionLayout } from './examSession';
import type { ExamKind } from './exam';
import type { Blueprint } from './types';

// Cuanto dura una sesion abierta (la base admite hasta 12 horas).
export const SESSION_HOURS = 3;

export interface SessionRow {
  id: string;
  blueprint_id: string;
  classroom_id: string;
  student_id: string;
  kind: 'period' | 'final';
  period_id: string | null;
  question_ids: string[];
  layout: SessionLayout;
  expires_at: string;
  closed_at: string | null;
  results: Record<string, boolean> | null;
  score_percent: number | null;
}

export type NewSession = Pick<SessionRow, 'blueprint_id' | 'classroom_id' | 'student_id' | 'kind' | 'period_id' | 'question_ids' | 'layout'> & { expires_at: string };

export type CreateResult = { ok: true; session: SessionRow } | { ok: false; reason: 'conflict' | 'mastered' | 'rejected' };
export type CloseResult = { ok: true; attemptNumber: number } | { ok: false; reason: 'closed' | 'expired' | 'mastered' | 'missing' };

export interface RunDb {
  publishedPlan(classroomId: string): Promise<{ id: string; version: number; doc: unknown } | null>;
  isEnrolled(classroomId: string, studentId: string): Promise<boolean>;
  listQuestions(blueprintId: string): Promise<BankRow[]>;
  // Lo que el estudiante ya hizo en el curso (para la regla «100 % para avanzar»).
  courseData(classroomId: string, studentId: string): Promise<CourseData>;
  // La sesion ABIERTA (sin cerrar) de esa evaluacion, si hay; el vencimiento lo decide el flujo.
  openSession(blueprintId: string, studentId: string, kind: 'period' | 'final', periodId: string | null): Promise<SessionRow | null>;
  createSession(row: NewSession): Promise<CreateResult>;
  // Una sesion de ESE estudiante (de otro, null).
  getSession(sessionId: string, studentId: string): Promise<SessionRow | null>;
  closeSession(sessionId: string, results: Record<string, boolean>, score: number): Promise<CloseResult>;
  materialNames(materialIds: string[]): Promise<Map<string, string>>;
}

export interface RunCtx {
  studentId: string;
  now?: () => Date;
  rng?: () => number;
}

type Fail = { ok: false; status: 400 | 403 | 404 | 409 | 410 | 422; error: string };

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StartOutcome = { ok: true; sessionId: string; expiresAt: string; resumed: boolean; questions: PresentedQuestion[] } | Fail;

const examOf = (kind: unknown, periodId: unknown): ExamKind | null => {
  if (kind === 'final') return periodId === undefined || periodId === null ? { kind: 'final' } : null;
  if (kind === 'period' && typeof periodId === 'string' && ID_RE.test(periodId)) return { kind: 'period', periodId };
  return null;
};

function present(session: SessionRow, rows: readonly BankRow[]): PresentedQuestion[] | null {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: PresentedQuestion[] = [];
  for (const id of session.question_ids) {
    const row = byId.get(id);
    if (!row) return null;
    out.push(presentQuestion(row, session.layout[id]));
  }
  return out;
}

export async function beginExam(db: RunDb, ctx: RunCtx, input: { classroomId: unknown; kind: unknown; periodId?: unknown }): Promise<StartOutcome> {
  const now = (ctx.now ?? (() => new Date()))();
  if (typeof input.classroomId !== 'string' || !UUID_RE.test(input.classroomId)) return { ok: false, status: 400, error: 'La clase no es válida.' };
  const exam = examOf(input.kind, input.periodId);
  if (!exam) return { ok: false, status: 400, error: 'La evaluación no es válida.' };

  if (!(await db.isEnrolled(input.classroomId, ctx.studentId))) return { ok: false, status: 403, error: 'No estás matriculado en esta clase.' };
  const stored = await db.publishedPlan(input.classroomId);
  if (!stored) return { ok: false, status: 404, error: 'Esta evaluación todavía no está disponible.' };
  const parsed = parseBlueprint(stored.doc);
  if (!parsed.ok) return { ok: false, status: 422, error: 'Esta evaluación no se puede abrir ahora.' };
  const plan: Blueprint = parsed.blueprint;
  if (exam.kind === 'period' && !plan.periods.some((p) => p.id === exam.periodId)) return { ok: false, status: 404, error: 'Ese corte no existe.' };

  // 100 % para avanzar (decision 2B): la evaluacion de un corte espera a dominar sus modulos, y la final a todos los cortes.
  const progress = await db.courseData(input.classroomId, ctx.studentId);
  if (progress.status === 'ok') {
    const gate = examGate(progress, exam);
    if (!gate.allowed) return { ok: false, status: 403, error: gate.message };
  }

  const periodId = exam.kind === 'period' ? exam.periodId : null;
  const rows = await db.listQuestions(stored.id);

  // Retomar la sesion abierta y vigente.
  const open = await db.openSession(stored.id, ctx.studentId, exam.kind, periodId);
  if (open && new Date(open.expires_at).getTime() > now.getTime()) {
    const questions = present(open, rows);
    if (!questions) return { ok: false, status: 409, error: 'Esta evaluación cambió mientras la hacías. Pide al profesor que la revise.' };
    return { ok: true, sessionId: open.id, expiresAt: open.expires_at, resumed: true, questions };
  }

  const started = startExam({ plan, rows, exam, rng: ctx.rng });
  if (!started.ok) return { ok: false, status: 422, error: 'Esta evaluación todavía no está lista: faltan preguntas aprobadas por el profesor.' };

  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString();
  const created = await db.createSession({ blueprint_id: stored.id, classroom_id: input.classroomId, student_id: ctx.studentId, kind: exam.kind, period_id: periodId, question_ids: started.questionIds, layout: started.layout, expires_at: expiresAt });
  if (!created.ok) {
    if (created.reason === 'mastered') return { ok: false, status: 409, error: 'Ya dominaste esta evaluación (100 %): no se repite.' };
    if (created.reason === 'conflict') return { ok: false, status: 409, error: 'Ya tienes esta evaluación abierta. Recarga la página para retomarla.' };
    return { ok: false, status: 422, error: 'Esta evaluación no se puede abrir ahora.' };
  }
  const questions = present(created.session, rows);
  if (!questions) return { ok: false, status: 409, error: 'Esta evaluación cambió mientras la abrías. Inténtalo de nuevo.' };
  return { ok: true, sessionId: created.session.id, expiresAt: created.session.expires_at, resumed: false, questions };
}

export interface ExamResult {
  attemptNumber: number | null;
  scorePercent: number;
  // 100 % = dominada: ya no se repite.
  mastered: boolean;
  feedback: ExamFeedback;
}
export type SubmitOutcome = ({ ok: true; alreadyClosed: boolean } & ExamResult) | Fail;

async function feedbackOf(db: RunDb, session: SessionRow, plan: Blueprint, rows: readonly BankRow[], results: Record<string, boolean>): Promise<ExamFeedback | null> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const served = session.question_ids.map((id) => byId.get(id));
  if (served.some((r) => !r)) return null;
  const questions = (served as BankRow[]).map(servedFromRow);
  // buildExamFeedback solo usa el NOMBRE del material (el texto no se muestra): se busca el nombre, no el contenido.
  const names = await db.materialNames(Array.from(new Set(questions.map((q) => q.source.materialId))));
  const chunks: ChunkIndex = new Map(questions.map((q) => [chunkKey(q.source.materialId, q.source.chunkIndex), { materialName: names.get(q.source.materialId) ?? 'Material de la clase', text: '' }]));
  return buildExamFeedback({ plan, chunks, questions, results: new Map(Object.entries(results)) });
}

async function planOf(db: RunDb, session: SessionRow): Promise<Blueprint | null> {
  const stored = await db.publishedPlan(session.classroom_id);
  // El plan de la sesion puede haberse archivado al publicar otra version: la retroalimentacion usa el que haya (los ids de modulo pueden haber cambiado; entonces `where` queda en null, sin inventar).
  if (!stored) return null;
  const parsed = parseBlueprint(stored.doc);
  return parsed.ok ? parsed.blueprint : null;
}

export async function submitExam(db: RunDb, ctx: RunCtx, input: { sessionId: unknown; answers: unknown }): Promise<SubmitOutcome> {
  const now = (ctx.now ?? (() => new Date()))();
  if (typeof input.sessionId !== 'string' || !UUID_RE.test(input.sessionId)) return { ok: false, status: 400, error: 'La sesión no es válida.' };
  const session = await db.getSession(input.sessionId, ctx.studentId);
  if (!session) return { ok: false, status: 404, error: 'No encontramos esa evaluación.' };

  const rows = await db.listQuestions(session.blueprint_id);
  const plan = await planOf(db, session);
  if (!plan) return { ok: false, status: 409, error: 'Esta evaluación ya no está disponible.' };

  // Ya cerrada: la misma retroalimentacion, sin otro intento.
  if (session.closed_at !== null && session.results && session.score_percent !== null) {
    const feedback = await feedbackOf(db, session, plan, rows, session.results);
    if (!feedback) return { ok: false, status: 409, error: 'No se pudo recuperar el resultado.' };
    return { ok: true, alreadyClosed: true, attemptNumber: null, scorePercent: session.score_percent, mastered: session.score_percent >= 100, feedback };
  }
  if (new Date(session.expires_at).getTime() <= now.getTime()) return { ok: false, status: 410, error: 'Se acabó el tiempo de esta evaluación. Empieza una nueva.' };

  const served = session.question_ids.map((id) => rows.find((r) => r.id === id));
  if (served.some((r) => !r)) return { ok: false, status: 409, error: 'Esta evaluación cambió mientras la hacías. Pide al profesor que la revise.' };
  const graded = gradeSession({ rows: served as BankRow[], layout: session.layout, answers: input.answers });

  const closed = await db.closeSession(session.id, graded.results, graded.scorePercent);
  if (!closed.ok) {
    if (closed.reason === 'expired') return { ok: false, status: 410, error: 'Se acabó el tiempo de esta evaluación. Empieza una nueva.' };
    if (closed.reason === 'mastered') return { ok: false, status: 409, error: 'Ya dominaste esta evaluación (100 %): no se repite.' };
    // 'closed': otra entrega la cerro justo antes; 'missing': desaparecio.
    return { ok: false, status: 409, error: 'Esta evaluación ya se entregó. Recarga la página.' };
  }
  const feedback = await feedbackOf(db, session, plan, rows, graded.results);
  if (!feedback) return { ok: false, status: 409, error: 'Se guardó tu resultado pero no se pudo armar la retroalimentación. Recarga la página.' };
  return { ok: true, alreadyClosed: false, attemptNumber: closed.attemptNumber, scorePercent: graded.scorePercent, mastered: graded.scorePercent >= 100, feedback };
}
