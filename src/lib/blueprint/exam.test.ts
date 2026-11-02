import { describe, expect, it } from 'vitest';
import { allocate, composeExam, DEFAULT_FINAL_EXAM_SIZE, DEFAULT_PERIOD_EXAM_SIZE, MAX_EXAM_QUESTIONS, MIN_EXAM_QUESTIONS, shuffle, type PoolQuestion } from './exam';
import type { Blueprint } from './types';

// rng con semilla (mulberry32): las pruebas son reproducibles.
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Plan: 3 comprensiones. Corte 1 evalua o1 y o2 (o1 se ve en m1 y m2; o2 en m3). Corte 2 evalua o2 y o3 (o2 y o3 en m4; o3 tambien en m5).
const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'Uno' }, { id: 'o2', statement: 'Dos' }, { id: 'o3', statement: 'Tres' }],
  periods: [
    {
      id: 'p1', name: 'A', order: 1, weight: 40, assessesOutcomeIds: ['o1', 'o2'],
      objectives: [
        { id: 'ob1', title: 'T1', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'M1', order: 1 }, { id: 'm2', title: 'M2', order: 2 }] },
        { id: 'ob2', title: 'T2', outcomeIds: ['o2'], modules: [{ id: 'm3', title: 'M3', order: 1 }] },
      ],
    },
    {
      id: 'p2', name: 'B', order: 2, weight: 60, assessesOutcomeIds: ['o2', 'o3'],
      objectives: [
        { id: 'ob3', title: 'T3', outcomeIds: ['o2', 'o3'], modules: [{ id: 'm4', title: 'M4', order: 1 }] },
        { id: 'ob4', title: 'T4', outcomeIds: ['o3'], modules: [{ id: 'm5', title: 'M5', order: 1 }] },
      ],
    },
  ],
});
// n preguntas de (comprension, modulo)
const pq = (outcomeId: string, nodeId: string, n: number, type = 'multiple_choice'): PoolQuestion[] => Array.from({ length: n }, (_, i) => ({ id: `${outcomeId}-${nodeId}-${i}`, outcomeId, nodeId, type }));
const POOL: PoolQuestion[] = [...pq('o1', 'm1', 6), ...pq('o1', 'm2', 6), ...pq('o2', 'm3', 8), ...pq('o2', 'm4', 8), ...pq('o3', 'm4', 6), ...pq('o3', 'm5', 6)];
const ok = (r: ReturnType<typeof composeExam>) => {
  if (!r.ok) throw new Error('fallo: ' + r.reason);
  return r;
};

describe('allocate', () => {
  it('reparte por igual y el resto va a los primeros', () => {
    expect(allocate(10, [9, 9, 9], [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocate(9, [9, 9, 9], [1, 1, 1])).toEqual([3, 3, 3]);
  });
  it('reparte por peso', () => {
    expect(allocate(10, [20, 20], [40, 60])).toEqual([4, 6]);
  });
  it('nadie recibe mas de lo que tiene y el sobrante pasa a los demas', () => {
    expect(allocate(10, [1, 20, 20], [1, 1, 1])).toEqual([1, 5, 4]);
    expect(allocate(10, [2, 2, 20], [1, 1, 1])).toEqual([2, 2, 6]);
  });
  it('si no alcanza, reparte todo lo que hay', () => {
    expect(allocate(50, [3, 4], [1, 1])).toEqual([3, 4]);
  });
  it('casos borde', () => {
    expect(allocate(0, [5, 5], [1, 1])).toEqual([0, 0]);
    expect(allocate(5, [], [])).toEqual([]);
    expect(allocate(6, [9, 9], [0, 0])).toEqual([3, 3]);
    expect(allocate(6, [9, 9], [-5, 1])).toEqual([0, 6]);
  });
  it('propiedad: suma exacta, nunca pasa del cupo (500 casos)', () => {
    const rng = seeded(7);
    for (let t = 0; t < 500; t++) {
      const n = 1 + Math.floor(rng() * 6);
      const cap = Array.from({ length: n }, () => Math.floor(rng() * 12));
      const w = Array.from({ length: n }, () => Math.floor(rng() * 5));
      const total = Math.floor(rng() * 40);
      const out = allocate(total, cap, w);
      expect(out.reduce((a, b) => a + b, 0)).toBe(Math.min(total, cap.reduce((a, b) => a + b, 0)));
      out.forEach((x, i) => {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(cap[i]);
      });
    }
  });
  it('propiedad: con pesos iguales y cupo de sobra, nadie se distancia de otro en mas de 1 (500 casos)', () => {
    const rng = seeded(11);
    for (let t = 0; t < 500; t++) {
      const n = 1 + Math.floor(rng() * 7);
      const out = allocate(Math.floor(rng() * 30), new Array(n).fill(100), new Array(n).fill(1));
      expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(1);
    }
  });
});

describe('composeExam: examen de un corte', () => {
  it('mide las comprensiones del corte, repartidas por igual, con 10 preguntas', () => {
    const r = ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'period', periodId: 'p1' }, rng: seeded(1) }));
    expect(r.questionIds).toHaveLength(DEFAULT_PERIOD_EXAM_SIZE);
    expect(r.perOutcome).toEqual({ o1: 5, o2: 5 });
  });
  it('solo entran preguntas de modulos de ESE corte (nunca de otro, aunque midan la misma comprension)', () => {
    const r = ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'period', periodId: 'p1' }, size: 20, rng: seeded(2) }));
    // o2 tiene preguntas en m3 (corte 1) y en m4 (corte 2): el corte 1 solo puede usar las de m3
    expect(r.questionIds.some((q) => q.includes('-m4-') || q.includes('-m5-') || q.startsWith('o3'))).toBe(false);
    expect(Object.keys(r.perModule).sort()).toEqual(['m1', 'm2', 'm3']);
  });
  it('dentro de una comprension reparte entre los modulos donde se vio (no siempre el mismo)', () => {
    const r = ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'period', periodId: 'p1' }, rng: seeded(3) }));
    expect(r.perModule.m1 + r.perModule.m2).toBe(5); // las 5 de o1
    expect(Math.abs(r.perModule.m1 - r.perModule.m2)).toBeLessThanOrEqual(1);
  });
  it('una comprension con pocas preguntas aporta lo que tiene y el resto lo ponen las demas', () => {
    const pool = [...pq('o1', 'm1', 2), ...pq('o2', 'm3', 30)];
    const r = ok(composeExam({ plan: plan(), pool, exam: { kind: 'period', periodId: 'p1' }, rng: seeded(4) }));
    expect(r.perOutcome).toEqual({ o1: 2, o2: 8 });
  });
  it('un corte que no existe: error claro', () => {
    expect(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'period', periodId: 'nope' } })).toMatchObject({ ok: false, reason: 'noSuchPeriod' });
  });
  it('un corte que no evalua ninguna comprension: error claro', () => {
    const p = plan();
    p.periods[0].assessesOutcomeIds = [];
    expect(composeExam({ plan: p, pool: POOL, exam: { kind: 'period', periodId: 'p1' } })).toMatchObject({ ok: false, reason: 'noOutcomes' });
  });
});

describe('composeExam: lo que el examen NO puede comprobar no se salta en silencio', () => {
  it('una comprension sin ninguna pregunta: no se arma y se dice cual', () => {
    const r = composeExam({ plan: plan(), pool: POOL.filter((q) => q.outcomeId !== 'o2'), exam: { kind: 'period', periodId: 'p1' } });
    expect(r).toMatchObject({ ok: false, reason: 'uncoveredOutcomes', missing: [{ outcomeId: 'o2', statement: 'Dos' }] });
  });
  it('preguntas de la comprension pero de modulos de OTRO corte no la cubren', () => {
    const r = composeExam({ plan: plan(), pool: [...pq('o1', 'm1', 6), ...pq('o2', 'm4', 6)], exam: { kind: 'period', periodId: 'p1' } });
    expect(r).toMatchObject({ ok: false, reason: 'uncoveredOutcomes', missing: [{ outcomeId: 'o2' }] });
  });
  it('un hueco en OTRO corte no impide el examen de este', () => {
    ok(composeExam({ plan: plan(), pool: POOL.filter((q) => q.outcomeId !== 'o3'), exam: { kind: 'period', periodId: 'p1' } }));
  });
  it('muy pocas preguntas en total: no se arma', () => {
    const r = composeExam({ plan: plan(), pool: [...pq('o1', 'm1', 2), ...pq('o2', 'm3', 2)], exam: { kind: 'period', periodId: 'p1' } });
    expect(r).toMatchObject({ ok: false, reason: 'tooFew' });
    expect(MIN_EXAM_QUESTIONS).toBe(5);
  });
  it('un tipo que el servidor no califica no cuenta (una comprension solo con minijuegos queda sin cubrir)', () => {
    const r = composeExam({ plan: plan(), pool: [...pq('o1', 'm1', 10), ...pq('o2', 'm3', 10, 'ordenar_pasos')], exam: { kind: 'period', periodId: 'p1' } });
    expect(r).toMatchObject({ ok: false, reason: 'uncoveredOutcomes', missing: [{ outcomeId: 'o2' }] });
  });
  it('filas mal formadas o repetidas del banco se ignoran sin romper', () => {
    const junk: any[] = [null, undefined, {}, { id: 5, outcomeId: 'o1', nodeId: 'm1', type: 'multiple_choice' }, { id: 'x', outcomeId: 'o1', nodeId: 7, type: 'multiple_choice' }, { id: 'y', outcomeId: 'o1', nodeId: 'm1', type: null }, { id: 'z', outcomeId: 'inventada', nodeId: 'm1', type: 'multiple_choice' }];
    const r = ok(composeExam({ plan: plan(), pool: [...POOL, ...POOL, ...junk], exam: { kind: 'period', periodId: 'p1' }, size: 20, rng: seeded(1) }));
    expect(new Set(r.questionIds).size).toBe(r.questionIds.length);
    expect(r.questionIds).not.toContain('z');
  });
});

describe('composeExam: evaluacion final', () => {
  it('mide TODAS las comprensiones del plan, con 20 preguntas repartidas por igual', () => {
    const r = ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'final' }, rng: seeded(1) }));
    expect(r.questionIds).toHaveLength(DEFAULT_FINAL_EXAM_SIZE);
    expect(Object.keys(r.perOutcome).sort()).toEqual(['o1', 'o2', 'o3']);
    expect(Math.max(...Object.values(r.perOutcome)) - Math.min(...Object.values(r.perOutcome))).toBeLessThanOrEqual(1);
  });
  it('toma de modulos de todos los cortes', () => {
    const r = ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'final' }, size: 30, rng: seeded(2) }));
    expect(Object.keys(r.perModule).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });
  it('un hueco en cualquier comprension impide la final', () => {
    expect(composeExam({ plan: plan(), pool: POOL.filter((q) => q.outcomeId !== 'o3'), exam: { kind: 'final' } })).toMatchObject({ ok: false, reason: 'uncoveredOutcomes', missing: [{ outcomeId: 'o3' }] });
  });
});

describe('composeExam: tamano', () => {
  const many = (n: number): { plan: Blueprint; pool: PoolQuestion[] } => {
    const p: Blueprint = {
      version: 1,
      outcomes: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, statement: `C${i}` })),
      periods: [{ id: 'p', name: 'P', order: 1, weight: 100, assessesOutcomeIds: Array.from({ length: n }, (_, i) => `o${i}`), objectives: Array.from({ length: n }, (_, i) => ({ id: `ob${i}`, title: 'T', outcomeIds: [`o${i}`], modules: [{ id: `m${i}`, title: 'M', order: 1 }] })) }],
    };
    return { plan: p, pool: Array.from({ length: n }, (_, i) => pq(`o${i}`, `m${i}`, 5)).flat() };
  };
  it('nunca baja de UNA pregunta por comprension: si hay mas comprensiones que preguntas pedidas, sube el tamano', () => {
    const { plan: p, pool } = many(8);
    const r = ok(composeExam({ plan: p, pool, exam: { kind: 'period', periodId: 'p' }, size: 5, rng: seeded(1) }));
    expect(r.questionIds).toHaveLength(8);
    expect(Object.values(r.perOutcome).every((x) => x === 1)).toBe(true);
  });
  it('respeta el tamano pedido y lo acota al maximo', () => {
    expect(ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'final' }, size: 12, rng: seeded(1) })).questionIds).toHaveLength(12);
    const big = [...pq('o1', 'm1', 100), ...pq('o2', 'm3', 100), ...pq('o2', 'm4', 100), ...pq('o3', 'm4', 100)];
    expect(ok(composeExam({ plan: plan(), pool: big, exam: { kind: 'final' }, size: 9999, rng: seeded(1) })).questionIds).toHaveLength(MAX_EXAM_QUESTIONS);
  });
  it('propiedad: sin repetidas, dentro del banco, cuentas que cuadran y TODA comprension medida tiene al menos una (200 casos)', () => {
    const rng = seeded(21);
    for (let t = 0; t < 200; t++) {
      const pool = [...pq('o1', 'm1', Math.floor(rng() * 9)), ...pq('o1', 'm2', Math.floor(rng() * 9)), ...pq('o2', 'm3', Math.floor(rng() * 9)), ...pq('o2', 'm4', Math.floor(rng() * 9)), ...pq('o3', 'm4', Math.floor(rng() * 9)), ...pq('o3', 'm5', Math.floor(rng() * 9))];
      const size = 5 + Math.floor(rng() * 25);
      const r = composeExam({ plan: plan(), pool, exam: { kind: 'final' }, size, rng });
      if (!r.ok) continue;
      const ids = new Set(pool.map((q) => q.id));
      expect(new Set(r.questionIds).size).toBe(r.questionIds.length);
      expect(r.questionIds.every((q) => ids.has(q))).toBe(true);
      expect(Object.values(r.perOutcome).reduce((a, b) => a + b, 0)).toBe(r.questionIds.length);
      expect(Object.values(r.perModule).reduce((a, b) => a + b, 0)).toBe(r.questionIds.length);
      expect(Object.values(r.perOutcome).every((x) => x >= 1)).toBe(true);
    }
  });
  it('no cambia sus entradas', () => {
    const p = plan();
    const before = JSON.stringify([p, POOL]);
    composeExam({ plan: p, pool: POOL, exam: { kind: 'final' }, rng: seeded(1) });
    expect(JSON.stringify([p, POOL])).toBe(before);
  });
});

describe('aleatoriedad', () => {
  it('es reproducible con la misma semilla y cambia con otra', () => {
    const a = ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'final' }, rng: seeded(9) }));
    const b = ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'final' }, rng: seeded(9) }));
    const c = ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'final' }, rng: seeded(10) }));
    expect(a.questionIds).toEqual(b.questionIds);
    expect(c.questionIds).not.toEqual(a.questionIds);
  });
  it('el orden final esta mezclado (no queda agrupado por comprension)', () => {
    const orders = new Set<string>();
    for (let s = 0; s < 20; s++) orders.add(ok(composeExam({ plan: plan(), pool: POOL, exam: { kind: 'final' }, rng: seeded(s) })).questionIds.map((q) => q[1]).join(''));
    expect(orders.size).toBeGreaterThan(15);
  });
  it('de una comprension con mas preguntas que su cupo se eligen DISTINTAS segun el azar', () => {
    const chosen = new Set<string>();
    for (let s = 0; s < 40; s++) for (const q of ok(composeExam({ plan: plan(), pool: [...pq('o1', 'm1', 20), ...pq('o2', 'm3', 20)], exam: { kind: 'period', periodId: 'p1' }, rng: seeded(s) })).questionIds) chosen.add(q);
    expect(chosen.size).toBeGreaterThan(25);
  });
  it('shuffle es una permutacion y puede dejar un elemento en su sitio (no es un ciclo forzado)', () => {
    let fixed = 0;
    for (let s = 0; s < 300; s++) {
      const out = shuffle([0, 1, 2, 3, 4], seeded(s));
      expect([...out].sort()).toEqual([0, 1, 2, 3, 4]);
      if (out.some((x, i) => x === i)) fixed++;
    }
    expect(fixed).toBeGreaterThan(100);
  });
  it('shuffle da todas las posiciones a cada elemento con frecuencias parecidas', () => {
    const pos = [0, 0, 0, 0];
    for (let s = 0; s < 2000; s++) pos[shuffle([0, 1, 2, 3], seeded(s)).indexOf(0)]++;
    for (const n of pos) expect(n).toBeGreaterThan(380);
  });
});
