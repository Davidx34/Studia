import { describe, expect, it } from 'vitest';
import { buildReview } from './examReviewView';
import type { BankRow } from './examBank';
import type { Blueprint } from './types';

const plan: Blueprint = {
  version: 1,
  outcomes: [{ id: 'o1', statement: 'Uno' }, { id: 'o2', statement: 'Dos' }],
  periods: [{ id: 'p1', name: 'Corte 1', order: 1, weight: 100, assessesOutcomeIds: ['o1', 'o2'], objectives: [{ id: 'ob1', title: 'T', outcomeIds: ['o1', 'o2'], modules: [{ id: 'm1', title: 'Modulo uno', order: 1 }] }] }],
};
const row = (over: Partial<BankRow>): BankRow => ({
  id: 'r', outcome_id: 'o1', node_id: 'm1', type: 'multiple_choice', q: 'Pregunta', opts: ['A. x', 'B. y'], ok: 1, answers: null, keywords: null, pairs: null, exp: 'e'.repeat(50),
  source_material_id: 'mat', source_chunk: 3, source_quote: 'cita textual', review_status: 'pending', judge_verdict: 'supported', judge_problems: [], ...over,
});
const names = new Map([['mat', 'Guia.pdf']]);

describe('buildReview', () => {
  it('un grupo por comprension del plan, tambien las que no tienen preguntas', () => {
    const g = buildReview(plan, [row({})], names);
    expect(g.map((x) => x.outcomeId)).toEqual(['o1', 'o2']);
    expect(g[1].items).toEqual([]);
  });
  it('cuenta aprobadas, pendientes y rechazadas por comprension', () => {
    const g = buildReview(plan, [row({ id: 'a', review_status: 'approved' }), row({ id: 'b' }), row({ id: 'c', review_status: 'rejected' }), row({ id: 'd', outcome_id: 'o2' })], names);
    expect([g[0].approved, g[0].pending, g[0].rejected]).toEqual([1, 1, 1]);
    expect([g[1].approved, g[1].pending, g[1].rejected]).toEqual([0, 1, 0]);
  });
  it('orden: pendientes con atencion, pendientes, aprobadas, rechazadas', () => {
    const g = buildReview(plan, [
      row({ id: 'rej', review_status: 'rejected' }),
      row({ id: 'ok', review_status: 'approved' }),
      row({ id: 'pend', judge_verdict: 'supported' }),
      row({ id: 'aten', judge_verdict: 'unclear', judge_problems: ['dudoso'] }),
    ], names);
    expect(g[0].items.map((i) => i.id)).toEqual(['aten', 'pend', 'ok', 'rej']);
  });
  it('lo no respaldado por el juez pide atencion (unclear y not_judged), lo respaldado no', () => {
    const g = buildReview(plan, [row({ id: 'a', judge_verdict: 'unclear' }), row({ id: 'b', judge_verdict: 'not_judged' }), row({ id: 'c' })], names);
    const by = Object.fromEntries(g[0].items.map((i) => [i.id, i]));
    expect([by.a.attention, by.b.attention, by.c.attention]).toEqual([true, true, false]);
    expect(by.c.verdictLabel).toBe('El juez la respalda');
    expect(by.a.verdictLabel).toContain('atencion');
  });
  it('marca la opcion correcta; una clave fuera de rango no marca ninguna', () => {
    const i = buildReview(plan, [row({})], names)[0].items[0];
    expect(i.options).toEqual([{ text: 'A. x', correct: false }, { text: 'B. y', correct: true }]);
    expect(buildReview(plan, [row({ ok: 9 })], names)[0].items[0].options.some((o) => o.correct)).toBe(false);
  });
  it('la clave de cada tipo se lee en una linea', () => {
    const k = (over: Partial<BankRow>) => buildReview(plan, [row(over)], names)[0].items[0].key;
    expect(k({ type: 'true_false', opts: null, ok: false })).toBe('Falso');
    expect(k({ type: 'true_false', opts: null, ok: true })).toBe('Verdadero');
    expect(k({ type: 'fill_blank', opts: null, answers: ['a', 'b'] })).toBe('Respuestas aceptadas: a · b');
    expect(k({ type: 'short_answer', opts: null, keywords: ['x', 'y'] })).toBe('Palabras clave: x · y');
    expect(k({ type: 'match', opts: null, pairs: [{ term: 'T', def: 'D' }, { term: 5 }] })).toBe('T → D');
  });
  it('material y modulo salen de sus nombres; si faltan, un texto neutro', () => {
    const i = buildReview(plan, [row({}), row({ id: 'z', node_id: 'gone', source_material_id: 'otro' })], names)[0].items;
    const a = i.find((x) => x.id === 'r')!;
    const z = i.find((x) => x.id === 'z')!;
    expect([a.materialName, a.moduleTitle, a.periodName, a.chunk]).toEqual(['Guia.pdf', 'Modulo uno', 'Corte 1', 3]);
    expect([z.materialName, z.moduleTitle]).toEqual(['Material de la clase', '(modulo que ya no esta en el plan)']);
  });
  it('datos raros en la base no rompen (problemas que no son lista, tipo desconocido)', () => {
    const i = buildReview(plan, [row({ judge_problems: 'x' as any, type: 'raro', opts: null })], names)[0].items[0];
    expect(i.problems).toEqual([]);
    expect(i.typeLabel).toBe('raro');
  });
});
