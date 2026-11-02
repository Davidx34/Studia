import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { approvedPool, bankSummary, reviewQuestion, saveGenerated, toRow, type BankDb, type BankRow, type GeneratedItem, type NewBankRow, type ReviewStatus } from './examBank';
import { supabaseBankDb } from './examBankDb';
import { composeExam } from './exam';
import type { ExamQuestion } from './examQuestion';
import type { Blueprint } from './types';

const MAT = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'Uno' }, { id: 'o2', statement: 'Dos' }],
  periods: [{ id: 'p1', name: 'A', order: 1, weight: 100, assessesOutcomeIds: ['o1', 'o2'], objectives: [
    { id: 'ob1', title: 'T', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'M1', order: 1 }] },
    { id: 'ob2', title: 'U', outcomeIds: ['o2'], modules: [{ id: 'm2', title: 'M2', order: 1 }] },
  ] }],
});
const eq = (over: Partial<ExamQuestion> = {}): ExamQuestion => ({
  outcomeId: 'o1', nodeId: 'm1', type: 'multiple_choice', q: 'Pregunta', opts: ['A. x', 'B. y'], ok: 1, exp: 'Una explicacion de fondo suficientemente larga para el banco de preguntas.', source: { materialId: MAT, chunkIndex: 2, quote: 'cita textual del material de la clase' }, ...over,
});
const item = (over: Partial<ExamQuestion> = {}, verdict: GeneratedItem['verdict'] = 'supported', problems: string[] = []): GeneratedItem => ({ question: eq(over), verdict, problems });

// Base en memoria con las reglas de la real: enunciado repetido por plan, revision por clase.
function memory(initial: BankRow[] = []) {
  const rows: (BankRow & { blueprint: string; classroom: string; reviewedBy?: string; reviewedAt?: string })[] = initial.map((r) => ({ ...r, blueprint: 'bp', classroom: 'c1' }));
  let n = 0;
  const calls: string[] = [];
  const db: BankDb = {
    async insertQuestions(bp, cl, news: NewBankRow[]) {
      calls.push(`insert(${news.length})`);
      let inserted = 0;
      let duplicates = 0;
      for (const r of news) {
        if (rows.some((x) => x.blueprint === bp && x.q === r.q)) duplicates++;
        else {
          rows.push({ ...r, id: `Q${++n}`, review_status: 'pending', blueprint: bp, classroom: cl });
          inserted++;
        }
      }
      return { inserted, duplicates };
    },
    async listQuestions(bp) {
      return rows.filter((x) => x.blueprint === bp).map((x) => ({ ...x }));
    },
    async setReview({ classroomId, questionId, status, reviewerId, reviewedAt }) {
      calls.push(`review(${questionId},${status})`);
      const r = rows.find((x) => x.id === questionId && x.classroom === classroomId);
      if (!r) return false;
      r.review_status = status;
      r.reviewedBy = reviewerId;
      r.reviewedAt = reviewedAt;
      return true;
    },
  };
  return { db, rows, calls };
}
const row = (over: Partial<BankRow> = {}): BankRow => ({ id: id(1), outcome_id: 'o1', node_id: 'm1', type: 'multiple_choice', q: 'q', opts: null, ok: null, answers: null, keywords: null, pairs: null, exp: 'e', source_material_id: MAT, source_chunk: 0, source_quote: 'c', review_status: 'pending', judge_verdict: 'supported', judge_problems: [], ...over });

describe('toRow / saveGenerated', () => {
  it('convierte una pregunta en una fila con su material, su revision del juez y SIN estado de revision', () => {
    const r = toRow(item({}, 'unclear', ['ambigua']));
    expect(r).toMatchObject({ outcome_id: 'o1', node_id: 'm1', type: 'multiple_choice', q: 'Pregunta', source_material_id: MAT, source_chunk: 2, source_quote: 'cita textual del material de la clase', judge_verdict: 'unclear', judge_problems: ['ambigua'] });
    expect(r).not.toHaveProperty('review_status');
    expect(r).not.toHaveProperty('id');
  });
  it('los campos que el tipo no usa quedan en null (no undefined) y los usados se conservan', () => {
    const r = toRow(item({ type: 'fill_blank', q: 'x', opts: undefined, ok: undefined, answers: ['a'] }));
    expect(r.opts).toBeNull();
    expect(r.ok).toBeNull();
    expect(r.answers).toEqual(['a']);
    expect(r.pairs).toBeNull();
    // false (verdadero/falso) NO se pierde por ser "falsy"
    expect(toRow(item({ type: 'true_false', ok: false, opts: undefined })).ok).toBe(false);
    expect(toRow(item({ ok: 0 })).ok).toBe(0);
  });
  it('los motivos del juez se acotan (cantidad y largo)', () => {
    const r = toRow(item({}, 'unsupported', Array.from({ length: 30 }, () => 'x'.repeat(1000))));
    expect((r.judge_problems as string[]).length).toBe(10);
    expect((r.judge_problems as string[])[0].length).toBe(300);
  });
  it('una pregunta nueva queda PENDIENTE (nadie la aprueba al guardarla, ni con veredicto "supported")', async () => {
    const m = memory();
    expect(await saveGenerated(m.db, { blueprintId: 'bp', classroomId: 'c1' }, [item({}, 'supported'), item({ q: 'otra' }, 'not_judged')])).toEqual({ inserted: 2, duplicates: 0 });
    expect(m.rows.map((r) => r.review_status)).toEqual(['pending', 'pending']);
  });
  it('lo no juzgado se guarda como not_judged (NO como aprobado)', async () => {
    const m = memory();
    await saveGenerated(m.db, { blueprintId: 'bp', classroomId: 'c1' }, [item({}, 'not_judged')]);
    expect(m.rows[0].judge_verdict).toBe('not_judged');
  });
  it('un enunciado repetido se cuenta y no tira las demas', async () => {
    const m = memory();
    await saveGenerated(m.db, { blueprintId: 'bp', classroomId: 'c1' }, [item()]);
    expect(await saveGenerated(m.db, { blueprintId: 'bp', classroomId: 'c1' }, [item(), item({ q: 'nueva' })])).toEqual({ inserted: 1, duplicates: 1 });
  });
  it('sin preguntas no toca la base', async () => {
    const m = memory();
    expect(await saveGenerated(m.db, { blueprintId: 'bp', classroomId: 'c1' }, [])).toEqual({ inserted: 0, duplicates: 0 });
    expect(m.calls).toEqual([]);
  });
});

describe('reviewQuestion', () => {
  const ctx = { classroomId: 'c1', reviewerId: 'prof', now: () => new Date('2026-11-02T10:00:00.000Z') };
  it('aprueba y rechaza, registrando quien y cuando', async () => {
    const m = memory([row({ id: id(1) })]);
    expect(await reviewQuestion(m.db, ctx, id(1), 'approved')).toEqual({ ok: true, status: 'approved' });
    expect(m.rows[0]).toMatchObject({ review_status: 'approved', reviewedBy: 'prof', reviewedAt: '2026-11-02T10:00:00.000Z' });
    expect(await reviewQuestion(m.db, ctx, id(1), 'rejected')).toEqual({ ok: true, status: 'rejected' });
    expect(m.rows[0].review_status).toBe('rejected');
  });
  it('una pregunta de OTRA clase: 404 y no se toca', async () => {
    const m = memory([row({ id: id(1) })]);
    const r = await reviewQuestion(m.db, { ...ctx, classroomId: 'c-ajena' }, id(1), 'approved');
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(m.rows[0].review_status).toBe('pending');
  });
  it('una pregunta que no existe: 404', async () => {
    expect(await reviewQuestion(memory().db, ctx, id(9), 'approved')).toMatchObject({ ok: false, status: 404 });
  });
  it('lo que llega del navegador se valida ANTES de tocar la base (id y decision)', async () => {
    const m = memory([row()]);
    for (const bad of [undefined, null, 5, '', 'no-uuid', "x'; drop table--", {}, []]) expect(await reviewQuestion(m.db, ctx, bad, 'approved'), String(bad)).toMatchObject({ ok: false, status: 400 });
    for (const d of [undefined, 'pending', 'APPROVED', 'delete', 1, null, {}]) expect(await reviewQuestion(m.db, ctx, id(1), d), String(d)).toMatchObject({ ok: false, status: 400 });
    expect(m.calls).toEqual([]);
  });
  it('"pending" NO es una decision valida (no se puede volver a pendiente ni aprobar sin mirar)', async () => {
    expect(await reviewQuestion(memory([row()]).db, ctx, id(1), 'pending')).toMatchObject({ ok: false, status: 400 });
  });
});

describe('approvedPool y composeExam', () => {
  const rows: BankRow[] = [
    row({ id: id(1), outcome_id: 'o1', node_id: 'm1', review_status: 'approved' }),
    row({ id: id(2), outcome_id: 'o1', node_id: 'm1', review_status: 'pending' }),
    row({ id: id(3), outcome_id: 'o2', node_id: 'm2', review_status: 'rejected' }),
    row({ id: id(4), outcome_id: 'o2', node_id: 'm2', review_status: 'approved', type: 'true_false' }),
  ];
  it('solo las APROBADAS entran, y solo con ids y tipos (nunca contenido ni claves)', () => {
    const pool = approvedPool(rows);
    expect(pool).toEqual([{ id: id(1), outcomeId: 'o1', nodeId: 'm1', type: 'multiple_choice' }, { id: id(4), outcomeId: 'o2', nodeId: 'm2', type: 'true_false' }]);
    expect(Object.keys(pool[0]).sort()).toEqual(['id', 'nodeId', 'outcomeId', 'type']);
  });
  it('pendientes y rechazadas NO cubren una comprension: el examen no se arma y dice cual falta', () => {
    const only = rows.filter((r) => r.outcome_id === 'o1' || r.review_status === 'rejected');
    const r = composeExam({ plan: plan(), pool: approvedPool(only), exam: { kind: 'period', periodId: 'p1' } });
    expect(r).toMatchObject({ ok: false, reason: 'uncoveredOutcomes', missing: [{ outcomeId: 'o2' }] });
  });
  it('lista vacia: nada', () => {
    expect(approvedPool([])).toEqual([]);
  });
});

describe('bankSummary', () => {
  const rows: BankRow[] = [
    row({ id: id(1), outcome_id: 'o1', review_status: 'approved' }),
    row({ id: id(2), outcome_id: 'o1', review_status: 'pending', judge_verdict: 'supported' }),
    row({ id: id(3), outcome_id: 'o1', review_status: 'pending', judge_verdict: 'unclear' }),
    row({ id: id(4), outcome_id: 'o1', review_status: 'pending', judge_verdict: 'not_judged' }),
    row({ id: id(5), outcome_id: 'o1', review_status: 'rejected' }),
  ];
  it('cuenta aprobadas, pendientes, rechazadas y las que piden atencion (pendientes que el juez no aprobo)', () => {
    const s = bankSummary(plan(), rows);
    expect(s.outcomes[0]).toEqual({ outcomeId: 'o1', statement: 'Uno', approved: 1, pending: 3, rejected: 1, needAttention: 2 });
  });
  it('una comprension sin ninguna aprobada esta SIN CUBRIR', () => {
    const s = bankSummary(plan(), rows);
    expect(s.uncovered.map((o) => o.outcomeId)).toEqual(['o2']);
    expect(s.outcomes[1]).toMatchObject({ approved: 0, pending: 0, rejected: 0 });
  });
  it('una comprension con preguntas pero NINGUNA aprobada (solo pendientes o rechazadas) tambien esta sin cubrir', () => {
    const s = bankSummary(plan(), [row({ id: id(1), outcome_id: 'o1', review_status: 'pending' }), row({ id: id(2), outcome_id: 'o2', review_status: 'rejected' }), row({ id: id(3), outcome_id: 'o2', review_status: 'approved' })]);
    expect(s.uncovered.map((o) => o.outcomeId)).toEqual(['o1']);
  });
  it('una aprobada ya no pide atencion aunque el juez no la haya aprobado', () => {
    const s = bankSummary(plan(), [row({ review_status: 'approved', judge_verdict: 'unclear' })]);
    expect(s.outcomes[0].needAttention).toBe(0);
  });
  it('preguntas de comprensiones que el plan ya no tiene se ignoran', () => {
    expect(bankSummary(plan(), [row({ outcome_id: 'fantasma', review_status: 'approved' })]).outcomes.every((o) => o.approved === 0)).toBe(true);
  });
});

// ───────── adaptador de Supabase (cliente simulado)
function fakeAdmin(handler: (table: string, chain: [string, unknown[]][]) => { data?: unknown; error?: { message: string; code?: string } | null }) {
  const log: { table: string; chain: [string, unknown[]][] }[] = [];
  const admin = {
    from(table: string) {
      const entry = { table, chain: [] as [string, unknown[]][] };
      log.push(entry);
      const q: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') return (res: (v: unknown) => unknown) => res({ data: null, error: null, ...handler(table, entry.chain) });
          return (...args: unknown[]) => {
            entry.chain.push([prop, args]);
            return q;
          };
        },
      });
      return q;
    },
  };
  const has = (i: number, op: string, ...args: unknown[]) => log[i].chain.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args));
  return { admin, log, has };
}

describe('supabaseBankDb', () => {
  it('insertQuestions: una por una, con plan y clase; el enunciado repetido (23505) se cuenta y otro error se lanza', async () => {
    let n = 0;
    const f = fakeAdmin(() => (++n === 2 ? { error: { message: 'dup', code: '23505' } } : {}));
    const rows = [toRow(item()), toRow(item({ q: 'dos' })), toRow(item({ q: 'tres' }))];
    expect(await supabaseBankDb(f.admin).insertQuestions('bp1', 'c1', rows)).toEqual({ inserted: 2, duplicates: 1 });
    expect(f.log[0].table).toBe('exam_questions');
    expect(f.log[0].chain[0][1]).toEqual([{ ...rows[0], blueprint_id: 'bp1', classroom_id: 'c1' }]);
    const bad = fakeAdmin(() => ({ error: { message: 'boom', code: '42501' } }));
    await expect(supabaseBankDb(bad.admin).insertQuestions('bp', 'c', [toRow(item())])).rejects.toThrow('bank.insert');
  });
  it('listQuestions: solo las del plan pedido, en orden de creacion', async () => {
    const f = fakeAdmin(() => ({ data: [row()] }));
    expect(await supabaseBankDb(f.admin).listQuestions('bp1')).toHaveLength(1);
    expect(f.has(0, 'eq', 'blueprint_id', 'bp1')).toBe(true);
    expect(f.has(0, 'order', 'created_at', { ascending: true })).toBe(true);
    await expect(supabaseBankDb(fakeAdmin(() => ({ error: { message: 'x' } })).admin).listQuestions('b')).rejects.toThrow('bank.list');
  });
  it('setReview: filtra por pregunta Y por clase, guarda quien y cuando, y devuelve si la encontro', async () => {
    const f = fakeAdmin(() => ({ data: [{ id: 'q' }] }));
    expect(await supabaseBankDb(f.admin).setReview({ classroomId: 'c1', questionId: 'q1', status: 'approved', reviewerId: 'prof', reviewedAt: 'ahora' })).toBe(true);
    expect(f.log[0].chain.find(([o]) => o === 'update')![1]).toEqual([{ review_status: 'approved', reviewed_by: 'prof', reviewed_at: 'ahora' }]);
    expect(f.has(0, 'eq', 'id', 'q1')).toBe(true);
    expect(f.has(0, 'eq', 'classroom_id', 'c1')).toBe(true);
    expect(await supabaseBankDb(fakeAdmin(() => ({ data: [] })).admin).setReview({ classroomId: 'c', questionId: 'q', status: 'rejected', reviewerId: 'p', reviewedAt: 'x' })).toBe(false);
    await expect(supabaseBankDb(fakeAdmin(() => ({ error: { message: 'x' } })).admin).setReview({ classroomId: 'c', questionId: 'q', status: 'rejected', reviewerId: 'p', reviewedAt: 'x' })).rejects.toThrow('bank.review');
  });
});

// ───────── ruta
describe('ruta /api/exam-bank', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/exam-bank/route.ts'), 'utf8');
  const idx = (s: string) => route.indexOf(s);
  it('pide sesion y que la clase sea SUYA (401 / 404) ANTES de usar la llave de servicio', () => {
    expect(route).toContain("if (!user) return fail(401, 'No autenticado');");
    expect(route).toContain(".eq('teacher_id', user.id)");
    expect(route).toContain("if (!classroom) return fail(404, 'Clase no encontrada');");
    expect(idx("fail(401")).toBeLessThan(idx('createAdminSupabase()'));
    expect(idx("fail(404, 'Clase no encontrada')")).toBeLessThan(idx('createAdminSupabase()'));
  });
  it('el revisor sale de la sesion, nunca del cuerpo', () => {
    expect(route).toContain('reviewerId: user.id');
    expect(route).not.toMatch(/body\??\.(reviewerId|reviewed_by|userId)/);
  });
  it('valida accion, id de clase y tamano del cuerpo antes de tocar nada', () => {
    expect(route).toContain("if (action !== 'review' && action !== 'generate') return fail(400, 'accion invalida');");
    expect(route).toContain("if (!UUID_RE.test(classroomId)) return fail(400, 'classroomId invalido');");
    expect(route).toContain('if (text.length > MAX_BODY_CHARS) return fail(413');
    expect(idx('MAX_BODY_CHARS)')).toBeLessThan(idx('JSON.parse'));
    expect(idx('JSON.parse')).toBeLessThan(idx('createServerSupabase()'));
  });
  it('solo revisa con reviewQuestion y no escribe ni lee la tabla por su cuenta', () => {
    expect(route).toContain('reviewQuestion(supabaseBankDb(admin), { classroomId, reviewerId: user.id }, body?.questionId, body?.decision)');
    expect(route).not.toMatch(/\.from\('exam_questions'\)/);
  });
  it('un error inesperado responde generico, sin filtrar el mensaje de la base', () => {
    expect(route).toContain("return fail(500, 'Error inesperado.');");
    expect(route).not.toMatch(/fail\(500,[^)]*\be\b/);
  });
  it('sin llave de servicio responde 503 con el motivo', () => {
    expect(route).toContain('if (!hasServiceRoleKey()) return fail(503, MISSING_SERVICE_KEY_MESSAGE);');
  });
  it('NUNCA devuelve el contenido de una pregunta (solo el nuevo estado)', () => {
    expect(route).toContain('NextResponse.json({ ok: true, status: r.status })');
  });
  it('generar: ids y proveedor de IA se comprueban ANTES del cupo, y el cupo ANTES de llamar a la IA; la propiedad antes que todo', () => {
    expect(route).toContain("if (typeof body?.outcomeId !== 'string' || !ID_RE.test(body.outcomeId) || typeof body?.nodeId !== 'string' || !ID_RE.test(body.nodeId)) return fail(400");
    expect(route).toContain("if (!hasStudyProvider()) return fail(503, 'No hay un proveedor de IA configurado.');");
    expect(route).toContain('QUOTA_POLICIES.examGenerate');
    expect(route).toContain("status: 429, headers: { 'Retry-After'");
    expect(idx("fail(404, 'Clase no encontrada')")).toBeLessThan(idx('consumeQuota('));
    expect(idx('ID_RE.test(body.outcomeId)')).toBeLessThan(idx('consumeQuota('));
    expect(idx('hasStudyProvider()')).toBeLessThan(idx('consumeQuota('));
    expect(idx('consumeQuota(')).toBeLessThan(idx('generateAndStore('));
  });
  it('generar: sin un proveedor distinto del que escribe NO hay juez (se dice, no se finge)', () => {
    expect(route).toContain('judge: hasJudgeProvider() ? callJudgeModel : undefined,');
    expect(route).toContain('model: callStudyModel,');
  });
  it('generar: la recuperacion del material esta acotada a la clase del profesor y el resumen no incluye contenido', () => {
    expect(route).toContain('retrieve: (query) => retrieveExamChunks(admin, { classroomId, query }),');
    expect(route).toContain('const { ok: _ok, ...summary } = r;');
    expect(route).not.toMatch(/accepted|\.question/);
  });
});

describe('estado de revision', () => {
  it('los tres estados del tipo coinciden con los de la base', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/088_exam_questions.sql'), 'utf8');
    const statuses: ReviewStatus[] = ['pending', 'approved', 'rejected'];
    for (const s of statuses) expect(sql).toContain(`'${s}'`);
  });
});
