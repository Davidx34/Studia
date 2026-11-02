// Generar preguntas de examen para UNA comprension en UN modulo y GUARDARLAS en el banco, pendientes de revision. Todo lo que toca el mundo (base, recuperacion del material, modelos) va
// INYECTADO para poder probarlo. La ruta solo comprueba sesion y propiedad de la clase y pone el cupo.
//
// El plan sobre el que se genera es el BORRADOR si existe (el que se esta armando) y, si no, el publicado: igual que los enlaces. Las preguntas pertenecen a esa version.
// Nada se aprueba aqui: todo entra PENDIENTE; el veredicto del juez de sustento se guarda para que el profesor sepa a cuales mirar con mas atencion.

import { generateExamQuestions, type ModelCaller, type SourceChunk } from './examGenerate';
import { saveGenerated, type BankDb, type GeneratedItem } from './examBank';
import { parseBlueprint } from './parse';
import { linkTarget } from './linkStore';
import type { BlueprintDb } from './store';

export interface FlowDeps {
  plans: Pick<BlueprintDb, 'list'>;
  bank: BankDb;
  // Los trozos de material que respaldan la comprension en el modulo (consulta = comprension + modulo).
  retrieve: (query: string) => Promise<SourceChunk[]>;
  model: ModelCaller;
  // Sin juez (no hay un proveedor distinto del generador), las preguntas se guardan como 'not_judged' (NO aprobadas) y se dice.
  judge?: ModelCaller;
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const DEFAULT_COUNT = 5;

export type FlowResult =
  | {
      ok: true;
      version: number;
      status: 'draft' | 'published';
      saved: number;
      duplicates: number;
      rejected: number;
      rejectedByJudge: number;
      judged: boolean;
      needsReview: number;
      excludedChunks: number;
      modelCalls: number;
      judgeCalls: number;
    }
  | { ok: false; status: 400 | 404 | 422 | 502 | 503; error: string };

export async function generateAndStore(deps: FlowDeps, ctx: { classroomId: string }, raw: { outcomeId: unknown; nodeId: unknown; count?: unknown }): Promise<FlowResult> {
  if (typeof raw.outcomeId !== 'string' || !ID_RE.test(raw.outcomeId) || typeof raw.nodeId !== 'string' || !ID_RE.test(raw.nodeId)) return { ok: false, status: 400, error: 'La comprension o el modulo no son validos.' };
  const count = typeof raw.count === 'number' && Number.isFinite(raw.count) ? Math.floor(raw.count) : DEFAULT_COUNT;

  const target = linkTarget(await deps.plans.list(ctx.classroomId));
  if (!target) return { ok: false, status: 404, error: 'Primero guarda un plan.' };
  const parsed = parseBlueprint(target.doc);
  if (!parsed.ok) return { ok: false, status: 422, error: 'El plan guardado no se pudo leer.' };
  const plan = parsed.blueprint;

  const outcome = plan.outcomes.find((o) => o.id === raw.outcomeId);
  const mod = plan.periods.flatMap((p) => p.objectives).flatMap((ob) => ob.modules.map((m) => ({ m, ob }))).find((x) => x.m.id === raw.nodeId);
  if (!outcome || !mod || !mod.ob.outcomeIds.includes(outcome.id)) return { ok: false, status: 400, error: 'Ese modulo no existe en el plan o no ensena esa comprension final.' };

  const chunks = await deps.retrieve(`${outcome.statement}. ${mod.m.title}`);
  if (chunks.length === 0) return { ok: false, status: 422, error: 'No hay material procesado de la clase en que apoyar las preguntas.' };

  const g = await generateExamQuestions({ plan, outcomeId: outcome.id, nodeId: mod.m.id, chunks, count }, deps.model, deps.judge);
  if (!g.ok) {
    if (g.reason === 'noResponse') return { ok: false, status: 503, error: 'La IA no respondio. Intenta de nuevo en un momento.' };
    if (g.reason === 'unparseable') return { ok: false, status: 502, error: 'La IA no devolvio preguntas en un formato utilizable.' };
    if (g.reason === 'noChunks') return { ok: false, status: 422, error: g.message };
    return { ok: false, status: 400, error: g.message };
  }

  // Cada pregunta lleva lo que dijo el juez: dudosa (unclear), respaldada (supported) o no juzgada (not_judged: NO es aprobada).
  const review = new Map(g.needsReview.map((r) => [r.question, r]));
  const items: GeneratedItem[] = g.accepted.map((q) => {
    const r = review.get(q);
    if (r) return { question: q, verdict: 'unclear' as const, problems: r.problems };
    return { question: q, verdict: g.judged ? ('supported' as const) : ('not_judged' as const), problems: [] };
  });
  const stored = await saveGenerated(deps.bank, { blueprintId: target.id, classroomId: ctx.classroomId }, items);

  return {
    ok: true,
    version: target.version,
    status: target.status as 'draft' | 'published',
    saved: stored.inserted,
    duplicates: stored.duplicates,
    rejected: g.rejected.length,
    rejectedByJudge: g.rejectedByJudge,
    judged: g.judged,
    needsReview: g.needsReview.length,
    excludedChunks: g.excludedChunks.length,
    modelCalls: g.modelCalls,
    judgeCalls: g.judgeCalls,
  };
}
