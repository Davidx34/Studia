import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { beginExam, submitExam, SESSION_HOURS, type CloseResult, type CreateResult, type NewSession, type RunDb, type SessionRow } from './examRun';
import { supabaseRunDb } from './examRunDb';
import type { BankRow } from './examBank';
import type { Blueprint } from './types';

const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const CLS = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const MAT = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-02T12:00:00.000Z');

const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'Uno' }, { id: 'o2', statement: 'Dos' }],
  periods: [{ id: 'p1', name: 'Corte 1', order: 1, weight: 100, assessesOutcomeIds: ['o1', 'o2'], objectives: [
    { id: 'ob1', title: 'T', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Modulo uno', order: 1 }] },
    { id: 'ob2', title: 'U', outcomeIds: ['o2'], modules: [{ id: 'm2', title: 'Modulo dos', order: 1 }] },
  ] }],
});

const row = (id: string, over: Partial<BankRow> = {}): BankRow => ({
  id, outcome_id: 'o1', node_id: 'm1', type: 'multiple_choice', q: 'Pregunta ' + id, opts: ['A. uno', 'B. dos', 'C. tres', 'D. cuatro'], ok: 2, answers: null, keywords: null, pairs: null,
  exp: 'Explicacion de fondo de la pregunta ' + id + ' con suficientes caracteres', source_material_id: MAT, source_chunk: 3, source_quote: 'cita textual de ' + id, review_status: 'approved', judge_verdict: 'supported', judge_problems: [], ...over,
});
const bank = (): BankRow[] => [
  ...Array.from({ length: 3 }, (_, i) => row(`a${i}`)),
  row('a3', { type: 'true_false', opts: null, ok: true }),
  row('a4', { type: 'fill_blank', opts: null, ok: null, answers: ['costo de oportunidad'] }),
  ...Array.from({ length: 3 }, (_, i) => row(`b${i}`, { outcome_id: 'o2', node_id: 'm2' })),
  row('b3', { outcome_id: 'o2', node_id: 'm2', type: 'match', opts: null, ok: null, pairs: [{ term: 'T1', def: 'D1' }, { term: 'T2', def: 'D2' }, { term: 'T3', def: 'D3' }] }),
  row('b4', { outcome_id: 'o2', node_id: 'm2', type: 'short_answer', opts: null, ok: null, keywords: ['pendiente'] }),
];

// Base en memoria con las reglas de la real (sesion abierta unica, dominada, vencimiento, cierre atomico).
function memory(o: { rows?: BankRow[]; enrolled?: boolean; published?: boolean; docOverride?: unknown } = {}) {
  const rows = o.rows ?? bank();
  const sessions: SessionRow[] = [];
  const attempts: { student: string; score: number; n: number }[] = [];
  const calls: string[] = [];
  let n = 0;
  const db: RunDb = {
    async publishedPlan() { calls.push('plan'); return o.published === false ? null : { id: 'bp1', version: 1, doc: o.docOverride ?? plan() }; },
    async isEnrolled(_c, s) { calls.push('enrolled'); return o.enrolled !== false && s !== OTHER; },
    async listQuestions() { return rows; },
    async openSession(_b, s, kind, p) { return sessions.find((x) => x.student_id === s && x.kind === kind && x.period_id === p && x.closed_at === null) ?? null; },
    async createSession(r: NewSession): Promise<CreateResult> {
      calls.push('create');
      if (attempts.some((a) => a.student === r.student_id && a.score >= 100)) return { ok: false, reason: 'mastered' };
      // la base descarta la abierta vencida antes de comprobar la unica
      const stale = sessions.findIndex((x) => x.student_id === r.student_id && x.kind === r.kind && x.period_id === r.period_id && x.closed_at === null && new Date(x.expires_at) <= NOW);
      if (stale >= 0) sessions.splice(stale, 1);
      if (sessions.some((x) => x.student_id === r.student_id && x.kind === r.kind && x.period_id === r.period_id && x.closed_at === null)) return { ok: false, reason: 'conflict' };
      const s: SessionRow = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, ...r, closed_at: null, results: null, score_percent: null };
      sessions.push(s);
      return { ok: true, session: s };
    },
    async getSession(id, s) { return sessions.find((x) => x.id === id && x.student_id === s) ?? null; },
    async closeSession(id, results, score): Promise<CloseResult> {
      calls.push('close');
      const s = sessions.find((x) => x.id === id);
      if (!s) return { ok: false, reason: 'missing' };
      if (s.closed_at !== null) return { ok: false, reason: 'closed' };
      if (new Date(s.expires_at) <= NOW) return { ok: false, reason: 'expired' };
      if (attempts.some((a) => a.student === s.student_id && a.score >= 100)) return { ok: false, reason: 'mastered' };
      const att = { student: s.student_id, score: score, n: attempts.filter((a) => a.student === s.student_id).length + 1 };
      attempts.push(att);
      s.closed_at = NOW.toISOString();
      s.results = results;
      s.score_percent = score;
      return { ok: true, attemptNumber: att.n };
    },
    async materialNames() { return new Map([[MAT, 'Guia de microeconomia.pdf']]); },
  };
  return { db, sessions, attempts, calls, rows };
}

const ctx = (over: Record<string, unknown> = {}) => ({ studentId: STUDENT, now: () => NOW, rng: seeded(7), ...over });
const START = { classroomId: CLS, kind: 'period', periodId: 'p1' };

// La jugada que el estudiante haria viendo las preguntas servidas: acierta todas salvo las de `wrong`.
function play(presented: { id: string; type: string; opts?: string[]; defs?: string[]; terms?: string[] }[], rows: BankRow[], wrong: string[] = []) {
  const answers: Record<string, unknown> = {};
  for (const p of presented) {
    const r = rows.find((x) => x.id === p.id)!;
    const bad = wrong.includes(p.id);
    if (p.type === 'multiple_choice') {
      const right = (r.opts as string[])[r.ok as number].replace(/^[A-H]\.\s+/, '');
      const pos = p.opts!.indexOf(right);
      answers[p.id] = { selectedIndex: bad ? (pos + 1) % p.opts!.length : pos };
    } else if (p.type === 'true_false') answers[p.id] = { selected: bad ? !r.ok : r.ok };
    else if (p.type === 'fill_blank') answers[p.id] = { text: bad ? 'no se' : 'el costo de oportunidad' };
    else if (p.type === 'short_answer') answers[p.id] = { text: bad ? 'nada' : 'la pendiente' };
    else if (p.type === 'match') {
      const pairs = r.pairs as { term: string; def: string }[];
      answers[p.id] = { defs: bad ? pairs.map(() => 'otra') : pairs.map((x) => x.def) };
    }
  }
  return answers;
}
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error('fallo: ' + JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

describe('beginExam: validacion y acceso', () => {
  it('rechaza lo mal formado antes de tocar la base', async () => {
    const m = memory();
    for (const input of [{ classroomId: 'x', kind: 'final' }, { classroomId: CLS, kind: 'raro' }, { classroomId: CLS, kind: 'period' }, { classroomId: CLS, kind: 'period', periodId: '../x' }, { classroomId: CLS, kind: 'final', periodId: 'p1' }, { classroomId: 5, kind: 'final' }]) {
      const r = await beginExam(m.db, ctx(), input as any);
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
    expect(m.calls).toEqual([]);
  });
  it('solo un estudiante MATRICULADO (403) y sobre un plan PUBLICADO (404)', async () => {
    expect(await beginExam(memory({ enrolled: false }).db, ctx(), START)).toMatchObject({ ok: false, status: 403 });
    expect(await beginExam(memory().db, ctx({ studentId: OTHER }), START)).toMatchObject({ ok: false, status: 403 });
    expect(await beginExam(memory({ published: false }).db, ctx(), START)).toMatchObject({ ok: false, status: 404 });
    expect(await beginExam(memory({ docOverride: { version: 1 } }).db, ctx(), START)).toMatchObject({ ok: false, status: 422 });
    expect(await beginExam(memory().db, ctx(), { ...START, periodId: 'nope' })).toMatchObject({ ok: false, status: 404 });
  });
  it('la matricula se comprueba antes de mirar el plan', async () => {
    const m = memory({ enrolled: false });
    await beginExam(m.db, ctx(), START);
    expect(m.calls).toEqual(['enrolled']);
  });
});

describe('beginExam: empezar y retomar', () => {
  it('sirve preguntas aprobadas SIN claves, y guarda la sesion con vencimiento y barajado', async () => {
    const m = memory();
    const r = must(await beginExam(m.db, ctx(), START));
    expect(r.resumed).toBe(false);
    expect(r.questions.length).toBe(10);
    expect(r.expiresAt).toBe(new Date(NOW.getTime() + SESSION_HOURS * 3600_000).toISOString());
    const text = JSON.stringify(r.questions);
    for (const k of ['"ok"', '"answers"', '"keywords"', '"pairs"', '"exp"', 'Explicacion de fondo', 'cita textual', 'costo de oportunidad', 'source']) expect(text).not.toContain(k);
    const s = m.sessions[0];
    expect(s).toMatchObject({ student_id: STUDENT, classroom_id: CLS, blueprint_id: 'bp1', kind: 'period', period_id: 'p1' });
    expect(s.question_ids).toEqual(r.questions.map((q) => q.id));
    expect(Object.keys(s.layout).length).toBeGreaterThan(0);
  });
  it('solo entran preguntas APROBADAS', async () => {
    const rows = bank().map((r, i) => (i === 0 ? { ...r, review_status: 'pending' as const } : r));
    const r = must(await beginExam(memory({ rows }).db, ctx(), START));
    expect(r.questions.some((q) => q.id === 'a0')).toBe(false);
  });
  it('la final no lleva corte', async () => {
    const m = memory();
    must(await beginExam(m.db, ctx(), { classroomId: CLS, kind: 'final' }));
    expect(m.sessions[0]).toMatchObject({ kind: 'final', period_id: null });
  });
  it('recargar RETOMA: mismas preguntas y mismo barajado, sin otra sesion', async () => {
    const m = memory();
    const a = must(await beginExam(m.db, ctx(), START));
    const b = must(await beginExam(m.db, ctx({ rng: seeded(99) }), START));
    expect(b.resumed).toBe(true);
    expect(b.sessionId).toBe(a.sessionId);
    expect(b.questions).toEqual(a.questions);
    expect(m.sessions).toHaveLength(1);
    expect(m.calls.filter((c) => c === 'create')).toHaveLength(1);
  });
  it('la sesion de otro estudiante no se retoma', async () => {
    const m = memory();
    must(await beginExam(m.db, ctx(), START));
    const r = await beginExam(m.db, ctx({ studentId: OTHER }), START);
    expect(r).toMatchObject({ ok: false, status: 403 }); // no esta matriculado en la base de prueba
    expect(m.sessions).toHaveLength(1);
  });
  it('una sesion VENCIDA no se retoma: empieza una nueva', async () => {
    const m = memory();
    const a = must(await beginExam(m.db, ctx(), START));
    m.sessions[0].expires_at = new Date(NOW.getTime() - 1000).toISOString();
    const b = must(await beginExam(m.db, ctx(), START));
    expect(b.resumed).toBe(false);
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(m.sessions).toHaveLength(1);
  });
  it('una sesion que vence JUSTO ahora no se retoma', async () => {
    const m = memory();
    must(await beginExam(m.db, ctx(), START));
    m.sessions[0].expires_at = NOW.toISOString();
    expect(must(await beginExam(m.db, ctx(), START)).resumed).toBe(false);
  });
  it('sin preguntas aprobadas suficientes: 422 con mensaje para el estudiante, sin detalles del banco', async () => {
    const rows = bank().map((r) => ({ ...r, review_status: 'pending' as const }));
    const r = await beginExam(memory({ rows }).db, ctx(), START);
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(JSON.stringify(r)).not.toMatch(/outcome|comprension|uncovered|pendiente|aprobada: /i);
  });
  it('ya dominada (409) y carrera entre dos inicios (409)', async () => {
    const m = memory();
    m.attempts.push({ student: STUDENT, score: 100, n: 1 });
    expect(await beginExam(m.db, ctx(), START)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('dominaste') });
    const racing = memory();
    racing.db.createSession = async () => ({ ok: false, reason: 'conflict' });
    expect(await beginExam(racing.db, ctx(), START)).toMatchObject({ ok: false, status: 409 });
    const rejected = memory();
    rejected.db.createSession = async () => ({ ok: false, reason: 'rejected' });
    expect(await beginExam(rejected.db, ctx(), START)).toMatchObject({ ok: false, status: 422 });
  });
  it('si una pregunta de la sesion desaparecio del banco, 409 al retomar', async () => {
    const m = memory();
    must(await beginExam(m.db, ctx(), START));
    m.rows.splice(0, m.rows.length, ...m.rows.filter((r) => r.id !== m.sessions[0].question_ids[0]));
    expect(await beginExam(m.db, ctx(), START)).toMatchObject({ ok: false, status: 409 });
  });
  it('una pregunta rechazada por el profesor DESPUES de empezar sigue sirviendose a esa sesion (lo servido no cambia)', async () => {
    const m = memory();
    const a = must(await beginExam(m.db, ctx(), START));
    m.rows.find((r) => r.id === a.questions[0].id)!.review_status = 'rejected';
    const b = must(await beginExam(m.db, ctx(), START));
    expect(b.questions.map((q) => q.id)).toEqual(a.questions.map((q) => q.id));
  });
});

describe('submitExam', () => {
  async function started(m = memory()) {
    const r = must(await beginExam(m.db, ctx(), START));
    return { m, r };
  }
  it('jugada perfecta: 100 %, dominada, intento 1 y retroalimentacion con todo bien', async () => {
    const { m, r } = await started();
    const out = must(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: play(r.questions, m.rows) }));
    expect(out).toMatchObject({ scorePercent: 100, mastered: true, attemptNumber: 1, alreadyClosed: false });
    expect(out.feedback.total).toBe(10);
    expect(out.feedback.items.every((i) => i.correct)).toBe(true);
    expect(out.feedback.toReview).toEqual([]);
    expect(m.sessions[0].closed_at).not.toBeNull();
  });
  it('3D: cada pregunta trae explicacion, corte, modulo y material con cita, y NINGUNA clave', async () => {
    const { m, r } = await started();
    const wrong = [r.questions[0].id, r.questions[1].id];
    const out = must(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: play(r.questions, m.rows, wrong) }));
    expect(out.scorePercent).toBe(80);
    expect(out.mastered).toBe(false);
    const bad = out.feedback.items.filter((i) => !i.correct).map((i) => i.questionId).sort();
    expect(bad).toEqual([...wrong].sort());
    for (const it of out.feedback.items) {
      expect(it.explanation).toContain('Explicacion de fondo');
      expect(it.where).toMatchObject({ periodName: 'Corte 1', materialName: 'Guia de microeconomia.pdf' });
      expect(it.where!.quote).toContain('cita textual de');
      expect(it.where!.moduleTitle).toMatch(/Modulo (uno|dos)/);
    }
    expect(out.feedback.toReview.length).toBeGreaterThan(0);
    const text = JSON.stringify(out.feedback);
    for (const k of ['"ok"', '"answers"', '"keywords"', '"pairs"', '"opts"', 'selectedIndex', 'costo de oportunidad']) expect(text).not.toContain(k);
  });
  it('el barajado se respeta: la posicion que vio el estudiante se traduce con el barajado guardado', async () => {
    const { m, r } = await started();
    const mcs = r.questions.filter((q) => q.type === 'multiple_choice');
    expect(mcs.length).toBeGreaterThan(0);
    // contestar siempre la posicion 2 (lo que seria «C» sin barajar): acierta solo si por azar la correcta cayo ahi
    const answers: Record<string, unknown> = {};
    for (const q of mcs) answers[q.id] = { selectedIndex: 2 };
    const out = must(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers }));
    for (const q of mcs) {
      const original = m.rows.find((x) => x.id === q.id)!;
      const seenCorrectPos = q.opts!.indexOf((original.opts as string[])[original.ok as number].replace(/^[A-H]\.\s+/, ''));
      expect(out.feedback.items.find((i) => i.questionId === q.id)!.correct).toBe(seenCorrectPos === 2);
    }
  });
  it('sin respuestas: 0 % y el intento SI queda registrado', async () => {
    const { m, r } = await started();
    const out = must(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: {} }));
    expect(out).toMatchObject({ scorePercent: 0, attemptNumber: 1 });
    expect(m.attempts).toHaveLength(1);
  });
  it('entregar DOS veces no da otro intento: devuelve lo mismo', async () => {
    const { m, r } = await started();
    const first = must(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: play(r.questions, m.rows, [r.questions[0].id]) }));
    const again = must(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: play(r.questions, m.rows) }));
    expect(again.alreadyClosed).toBe(true);
    expect(again.scorePercent).toBe(first.scorePercent);
    expect(again.attemptNumber).toBeNull();
    expect(again.feedback.items.map((i) => i.correct)).toEqual(first.feedback.items.map((i) => i.correct));
    expect(m.attempts).toHaveLength(1);
    expect(m.calls.filter((c) => c === 'close')).toHaveLength(1);
  });
  it('reentregar un 100 % sigue diciendo que esta dominada', async () => {
    const { m, r } = await started();
    must(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: play(r.questions, m.rows) }));
    const again = must(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: {} }));
    expect(again).toMatchObject({ alreadyClosed: true, scorePercent: 100, mastered: true });
    // y a las 99.99 no: el limite es 100
    const m2 = memory();
    const s2 = must(await beginExam(m2.db, ctx(), START));
    must(await submitExam(m2.db, ctx(), { sessionId: s2.sessionId, answers: play(s2.questions, m2.rows, [s2.questions[0].id]) }));
    expect(must(await submitExam(m2.db, ctx(), { sessionId: s2.sessionId, answers: {} })).mastered).toBe(false);
  });
  it('al cerrar, una evaluacion ya dominada dice eso (no un mensaje generico)', async () => {
    const { m, r } = await started();
    m.db.closeSession = async () => ({ ok: false, reason: 'mastered' });
    expect(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: {} })).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('dominaste') });
  });
  it('el id de sesion mal formado (400), ajeno o inexistente (404)', async () => {
    const { m, r } = await started();
    expect(await submitExam(m.db, ctx(), { sessionId: 'x', answers: {} })).toMatchObject({ ok: false, status: 400 });
    expect(await submitExam(m.db, ctx(), { sessionId: 5, answers: {} })).toMatchObject({ ok: false, status: 400 });
    expect(await submitExam(m.db, ctx({ studentId: OTHER }), { sessionId: r.sessionId, answers: {} })).toMatchObject({ ok: false, status: 404 });
    expect(await submitExam(m.db, ctx(), { sessionId: '99999999-9999-4999-8999-999999999999', answers: {} })).toMatchObject({ ok: false, status: 404 });
  });
  it('una sesion vencida no se entrega (410) y no escribe intento', async () => {
    const { m, r } = await started();
    m.sessions[0].expires_at = new Date(NOW.getTime() - 1).toISOString();
    expect(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: play(r.questions, m.rows) })).toMatchObject({ ok: false, status: 410 });
    expect(m.attempts).toHaveLength(0);
    expect(m.calls).not.toContain('close');
  });
  it('si la base dice vencida / dominada / ya cerrada al cerrar, se traduce sin filtrar', async () => {
    for (const [reason, status] of [['expired', 410], ['mastered', 409], ['closed', 409], ['missing', 409]] as const) {
      const { m, r } = await started();
      m.db.closeSession = async () => ({ ok: false, reason });
      const out = await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: {} });
      expect(out).toMatchObject({ ok: false, status });
    }
  });
  it('si una pregunta servida ya no esta en el banco, 409 y no se cierra', async () => {
    const { m, r } = await started();
    m.rows.splice(0, 1);
    expect(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: {} })).toMatchObject({ ok: false, status: 409 });
    expect(m.attempts).toHaveLength(0);
  });
  it('el plan ya no publicado: 409 (no se inventa retroalimentacion)', async () => {
    const { m, r } = await started();
    m.db.publishedPlan = async () => null;
    expect(await submitExam(m.db, ctx(), { sessionId: r.sessionId, answers: {} })).toMatchObject({ ok: false, status: 409 });
  });
  it('un segundo intento tras fallar es el intento 2, y tras el 100 % ya no hay mas', async () => {
    const m = memory();
    const a = must(await beginExam(m.db, ctx(), START));
    expect(must(await submitExam(m.db, ctx(), { sessionId: a.sessionId, answers: {} })).attemptNumber).toBe(1);
    const b = must(await beginExam(m.db, ctx(), START));
    expect(b.resumed).toBe(false);
    expect(must(await submitExam(m.db, ctx(), { sessionId: b.sessionId, answers: play(b.questions, m.rows) })).attemptNumber).toBe(2);
    expect(await beginExam(m.db, ctx(), START)).toMatchObject({ ok: false, status: 409 });
  });
  it('respuestas basura no tiran: cuentan como incorrectas', async () => {
    const { m, r } = await started();
    for (const answers of [null, undefined, 5, 'x', [], { [r.questions[0].id]: 'zzz' }]) {
      const mm = memory();
      const s = must(await beginExam(mm.db, ctx(), START));
      const out = must(await submitExam(mm.db, ctx(), { sessionId: s.sessionId, answers }));
      expect(out.scorePercent).toBe(0);
    }
    expect(m.sessions).toHaveLength(1);
  });
});

// ───────── adaptador
function fakeAdmin(script: Record<string, any>) {
  const log: { table: string; op: string; args: unknown[] }[] = [];
  const chain = (table: string): any => {
    const p: any = new Proxy(
      {},
      {
        get(_t, op: string) {
          if (op === 'then') return undefined;
          return (...args: unknown[]) => {
            log.push({ table, op, args });
            if (op === 'maybeSingle' || op === 'single') return Promise.resolve(script[`${table}.${op}`] ?? { data: null, error: null });
            return p;
          };
        },
      }
    );
    return p;
  };
  return { admin: { from: chain, rpc: async (fn: string, args: unknown) => { log.push({ table: 'rpc', op: fn, args: [args] }); return script[`rpc.${fn}`] ?? { data: null, error: null }; } } as any, log };
}

describe('supabaseRunDb', () => {
  it('openSession: con corte filtra por el corte; en la final, period_id nulo; siempre solo abiertas', async () => {
    const a = fakeAdmin({});
    await supabaseRunDb(a.admin).openSession('bp', STUDENT, 'period', 'p1');
    expect(a.log.some((l) => l.op === 'eq' && l.args[0] === 'period_id' && l.args[1] === 'p1')).toBe(true);
    expect(a.log.some((l) => l.op === 'is' && l.args[0] === 'closed_at' && l.args[1] === null)).toBe(true);
    const b = fakeAdmin({});
    await supabaseRunDb(b.admin).openSession('bp', STUDENT, 'final', null);
    expect(b.log.some((l) => l.op === 'is' && l.args[0] === 'period_id')).toBe(true);
  });
  it('getSession filtra por la sesion Y por el estudiante', async () => {
    const a = fakeAdmin({});
    await supabaseRunDb(a.admin).getSession('sid', STUDENT);
    expect(a.log.filter((l) => l.op === 'eq').map((l) => l.args)).toEqual([['id', 'sid'], ['student_id', STUDENT]]);
  });
  it('createSession traduce 23505 (ya hay abierta), 23514 dominada o de otra regla, y lanza lo inesperado', async () => {
    const mk = (error: any) => supabaseRunDb(fakeAdmin({ 'exam_sessions.single': { data: null, error } }).admin);
    const input = { blueprint_id: 'b', classroom_id: 'c', student_id: 's', kind: 'final', period_id: null, question_ids: [], layout: {}, expires_at: 'x' } as NewSession;
    expect(await mk({ code: '23505', message: 'dup' }).createSession(input)).toEqual({ ok: false, reason: 'conflict' });
    expect(await mk({ code: '23514', message: 'La evaluacion ya se domino (100 %): no se repite' }).createSession(input)).toEqual({ ok: false, reason: 'mastered' });
    expect(await mk({ code: '23514', message: 'El plan no esta publicado' }).createSession(input)).toEqual({ ok: false, reason: 'rejected' });
    await expect(mk({ code: '42P01', message: 'boom secreto' }).createSession(input)).rejects.toThrow('run.create');
  });
  it('closeSession usa la funcion atomica y traduce sus rechazos', async () => {
    const a = fakeAdmin({ 'rpc.close_exam_session': { data: 3, error: null } });
    expect(await supabaseRunDb(a.admin).closeSession('sid', { q1: true }, 100)).toEqual({ ok: true, attemptNumber: 3 });
    expect(a.log.find((l) => l.table === 'rpc')).toMatchObject({ op: 'close_exam_session', args: [{ p_session: 'sid', p_results: { q1: true }, p_score: 100 }] });
    const err = (message: string, code = '23514') => supabaseRunDb(fakeAdmin({ 'rpc.close_exam_session': { data: null, error: { code, message } } }).admin).closeSession('s', {}, 0);
    expect(await err('La sesion ya se cerro')).toEqual({ ok: false, reason: 'closed' });
    expect(await err('La sesion vencio')).toEqual({ ok: false, reason: 'expired' });
    expect(await err('La evaluacion ya se domino (100 %): no se repite')).toEqual({ ok: false, reason: 'mastered' });
    expect(await err('La sesion no existe')).toEqual({ ok: false, reason: 'missing' });
    await expect(err('algo raro', 'XX000')).rejects.toThrow('run.close');
    await expect(err('algo raro')).rejects.toThrow('run.close');
  });
  it('materialNames: nombres por id, y sin ids no consulta', async () => {
    const a = fakeAdmin({});
    expect((await supabaseRunDb(a.admin).materialNames([])).size).toBe(0);
    expect(a.log).toHaveLength(0);
  });
  it('publishedPlan y isEnrolled filtran por clase (y estudiante) y plan publicado', async () => {
    const a = fakeAdmin({});
    const db = supabaseRunDb(a.admin);
    await db.publishedPlan(CLS);
    await db.isEnrolled(CLS, STUDENT);
    const eqs = a.log.filter((l) => l.op === 'eq').map((l) => l.args);
    expect(eqs).toEqual([['classroom_id', CLS], ['status', 'published'], ['classroom_id', CLS], ['student_id', STUDENT]]);
  });
});

// ───────── ruta
describe('ruta /api/exam', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/exam/route.ts'), 'utf8');
  const idx = (s: string) => route.indexOf(s);
  it('valida tamano, JSON y accion ANTES de pedir sesion; sesion antes de la llave de servicio', () => {
    expect(route).toContain('if (text.length > MAX_BODY_CHARS) return fail(413');
    expect(route).toContain("if (action !== 'start' && action !== 'submit') return fail(400, 'accion invalida');");
    expect(idx('MAX_BODY_CHARS)')).toBeLessThan(idx('JSON.parse'));
    expect(idx('JSON.parse')).toBeLessThan(idx('createServerSupabase()'));
    expect(route).toContain("if (!user) return fail(401, 'No autenticado');");
    expect(idx("fail(401")).toBeLessThan(idx('createAdminSupabase()'));
  });
  it('el estudiante sale de la sesion, nunca del cuerpo', () => {
    expect(route).toContain('const ctx = { studentId: user.id };');
    expect(route).not.toMatch(/body\??\.(studentId|student_id|userId|score|results|scorePercent|attempt)/);
  });
  it('los ids se validan ANTES del cupo y el cupo ANTES de tocar el flujo', () => {
    expect(idx("fail(400, 'classroomId invalido')")).toBeLessThan(idx('consumeQuota('));
    expect(idx("fail(400, 'sessionId invalido')")).toBeLessThan(idx('consumeQuota('));
    expect(route).toContain('QUOTA_POLICIES.examSession');
    expect(route).toContain("status: 429, headers: { 'Retry-After'");
    expect(idx('consumeQuota(')).toBeLessThan(idx('beginExam('));
    expect(idx('consumeQuota(')).toBeLessThan(idx('submitExam('));
  });
  it('solo llama al flujo: no lee ni escribe las tablas por su cuenta', () => {
    expect(route).not.toMatch(/\.from\('(exam_questions|exam_sessions|exam_attempts)'\)/);
    expect(route).toContain('beginExam(db, ctx, { classroomId: body.classroomId, kind: body.kind, periodId: body.periodId })');
    expect(route).toContain('submitExam(db, ctx, { sessionId: body.sessionId, answers: body.answers })');
  });
  it('responde sin cache y con error generico', () => {
    expect(route).toContain("'Cache-Control': 'no-store'");
    expect(route).toContain("return fail(500, 'Error inesperado.');");
    expect(route).not.toMatch(/fail\(500,[^)]*\be\b/);
    expect(route).toContain('if (!hasServiceRoleKey()) return fail(503, MISSING_SERVICE_KEY_MESSAGE);');
  });
});
