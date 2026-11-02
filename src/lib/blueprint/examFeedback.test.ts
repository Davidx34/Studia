import { describe, expect, it } from 'vitest';
import { buildExamFeedback, type ServedQuestion } from './examFeedback';
import { chunkKey, type ChunkIndex } from './examQuestion';
import type { Blueprint } from './types';

const MAT = '11111111-1111-4111-8111-111111111111';
const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'Explica la elasticidad' }, { id: 'o2', statement: 'Calcula el equilibrio' }],
  periods: [
    { id: 'p1', name: 'Primer corte', order: 1, weight: 50, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'T1', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Concepto', order: 1 }, { id: 'm2', title: 'Calculo', order: 2 }] }] },
    { id: 'p2', name: 'Segundo corte', order: 2, weight: 50, assessesOutcomeIds: ['o2'], objectives: [{ id: 'ob2', title: 'T2', outcomeIds: ['o2'], modules: [{ id: 'm3', title: 'Oferta y demanda', order: 1 }] }] },
  ],
});
const chunks = (): ChunkIndex => new Map([[chunkKey(MAT, 0), { materialName: 'Guía', text: 'x' }]]);
const sq = (id: string, outcomeId: string, nodeId: string, over: Partial<ServedQuestion> = {}): ServedQuestion => ({
  id, outcomeId, nodeId, type: 'multiple_choice', q: `Pregunta ${id}`, opts: ['A. a', 'B. b'], ok: 0, exp: `Explicacion de ${id}`, source: { materialId: MAT, chunkIndex: 0, quote: `cita ${id}` }, ...over,
});
const Q = [sq('a', 'o1', 'm1'), sq('b', 'o1', 'm2'), sq('c', 'o1', 'm1'), sq('d', 'o2', 'm3')];
const run = (results: Record<string, boolean>, questions = Q) => buildExamFeedback({ plan: plan(), chunks: chunks(), questions, results: new Map(Object.entries(results)) });

describe('buildExamFeedback', () => {
  it('marca CADA pregunta como bien o mal, en el orden en que se sirvio', () => {
    const f = run({ a: true, b: false, c: true, d: false });
    expect(f.items.map((i) => [i.position, i.questionId, i.correct])).toEqual([[1, 'a', true], [2, 'b', false], [3, 'c', true], [4, 'd', false]]);
    expect(f.total).toBe(4);
    expect(f.correct).toBe(2);
    expect(f.scorePercent).toBe(50);
  });
  it('TODAS las preguntas llevan su explicacion (las bien y las mal contestadas)', () => {
    const f = run({ a: true, b: false });
    for (const it of f.items) expect(it.explanation).toBe(`Explicacion de ${it.questionId}`);
    expect(f.items[0].correct).toBe(true);
    expect(f.items[1].correct).toBe(false);
  });
  it('de cada pregunta dice el corte, el modulo y el material explicito con su cita', () => {
    const f = run({ a: true });
    expect(f.items[0].where).toEqual({ periodId: 'p1', periodName: 'Primer corte', nodeId: 'm1', moduleTitle: 'Concepto', outcomeId: 'o1', outcomeStatement: 'Explica la elasticidad', materialId: MAT, materialName: 'Guía', quote: 'cita a' });
    expect(f.items[3].where).toMatchObject({ periodName: 'Segundo corte', moduleTitle: 'Oferta y demanda' });
  });
  it('una pregunta SIN resultado del servidor no cuenta como acertada', () => {
    const f = run({ a: true });
    expect(f.correct).toBe(1);
    expect(f.items.filter((i) => !i.correct).map((i) => i.questionId)).toEqual(['b', 'c', 'd']);
  });
  it('un resultado que no es exactamente true no cuenta', () => {
    const f = buildExamFeedback({ plan: plan(), chunks: chunks(), questions: Q, results: new Map<string, any>([['a', 1], ['b', 'true'], ['c', true]]) });
    expect(f.correct).toBe(1);
  });
  it('nunca incluye las claves de calificacion (opciones, respuesta correcta, parejas, palabras clave)', () => {
    const q = sq('z', 'o1', 'm1', { opts: ['A. secreta'], ok: 0, answers: ['clave'], pairs: [{ term: 't', def: 'd' }], keywords: ['kw'] });
    const json = JSON.stringify(run({ z: false }, [q]));
    for (const secret of ['secreta', 'clave', '"ok"', 'keywords', '"pairs"', '"opts"', '"answers"']) expect(json).not.toContain(secret);
  });
  it('que modulos repasar: solo los que tienen fallos, de mas a menos, y que comprension fallo en cada uno', () => {
    const f = run({ a: false, b: false, c: false, d: true });
    expect(f.toReview.map((t) => [t.moduleTitle, t.wrong, t.total])).toEqual([['Concepto', 2, 2], ['Calculo', 1, 1]]);
    expect(f.toReview[0]).toMatchObject({ periodName: 'Primer corte', nodeId: 'm1', outcomes: ['Explica la elasticidad'] });
    expect(f.toReview.find((t) => t.nodeId === 'm3')).toBeUndefined(); // acerto todo en m3
  });
  it('a igualdad de fallos, el orden del recorrido del plan', () => {
    const f = run({ a: true, b: false, c: true, d: false });
    expect(f.toReview.map((t) => t.nodeId)).toEqual(['m2', 'm3']);
  });
  it('repasa primero el modulo con MAS fallos aunque en el examen haya salido despues', () => {
    // m1: 1 fallo (sale primero en el examen), m2: 2 fallos (sale despues)
    const qs = [sq('a', 'o1', 'm1'), sq('b', 'o1', 'm2'), sq('c', 'o1', 'm2')];
    const f = run({ a: false, b: false, c: false }, qs);
    expect(f.toReview.map((t) => [t.nodeId, t.wrong])).toEqual([['m2', 2], ['m1', 1]]);
  });
  it('a igualdad de fallos manda el orden del PLAN, no el del examen', () => {
    // el examen pregunto primero de m3 (corte 2) y despues de m1 (corte 1): con un fallo cada uno, repasa primero m1
    const qs = [sq('d', 'o2', 'm3'), sq('a', 'o1', 'm1')];
    const f = run({ d: false, a: false }, qs);
    expect(f.toReview.map((t) => t.nodeId)).toEqual(['m1', 'm3']);
  });
  it('si acerto todo no hay nada que repasar', () => {
    const f = run({ a: true, b: true, c: true, d: true });
    expect(f.toReview).toEqual([]);
    expect(f.scorePercent).toBe(100);
  });
  it('una pregunta que el plan ya no puede ubicar se muestra SIN inventar donde se vio, y no entra en los temas a repasar', () => {
    const f = run({ x: false }, [sq('x', 'o1', 'ya-no-existe')]);
    expect(f.items[0].where).toBeNull();
    expect(f.items[0].explanation).toBe('Explicacion de x');
    expect(f.toReview).toEqual([]);
  });
  it('un material que ya no existe deja el nombre vacio pero conserva la cita', () => {
    const f = buildExamFeedback({ plan: plan(), chunks: new Map(), questions: [Q[0]], results: new Map([['a', false]]) });
    expect(f.items[0].where).toMatchObject({ materialName: '', quote: 'cita a' });
  });
  it('sin preguntas: nota 0 y sin romper', () => {
    expect(run({}, [])).toEqual({ total: 0, correct: 0, scorePercent: 0, items: [], toReview: [] });
  });
  it('la nota se redondea a 2 decimales', () => {
    const f = run({ a: true }, [Q[0], Q[1], Q[2]]);
    expect(f.scorePercent).toBe(33.33);
  });
  it('no cambia sus entradas', () => {
    const before = JSON.stringify([plan(), Q]);
    run({ a: true });
    expect(JSON.stringify([plan(), Q])).toBe(before);
  });
});
