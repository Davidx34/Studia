import { describe, expect, it } from 'vitest';
import { allocate, composeExam, shuffle, DEFAULT_FINAL_EXAM_SIZE, DEFAULT_PERIOD_EXAM_SIZE, EXAM_QUESTION_TYPES, MAX_EXAM_QUESTIONS, MIN_EXAM_QUESTIONS, type BankQuestion } from './exam';
import type { Blueprint } from './types';

// rng con semilla (mulberry32): las pruebas son reproducibles.
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'x' }],
  periods: [
    { id: 'p1', name: 'A', order: 1, weight: 40, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'T', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Uno', order: 1 }, { id: 'm2', title: 'Dos', order: 2 }] }] },
    { id: 'p2', name: 'B', order: 2, weight: 60, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob2', title: 'T2', outcomeIds: ['o1'], modules: [{ id: 'm3', title: 'Tres', order: 1 }] }] },
  ],
});
const LINKS = [{ nodeId: 'm1', moduleId: 'R1' }, { nodeId: 'm2', moduleId: 'R2' }, { nodeId: 'm3', moduleId: 'R3' }];
const bankOf = (counts: Record<string, number>, type = 'multiple_choice'): BankQuestion[] => Object.entries(counts).flatMap(([moduleId, n]) => Array.from({ length: n }, (_, i) => ({ id: `${moduleId}-q${i}`, moduleId, type })));
const BANK = bankOf({ R1: 10, R2: 10, R3: 10 });
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
    expect(allocate(20, [50, 50], [1, 3])).toEqual([5, 15]);
  });
  it('nadie recibe mas de lo que tiene y el sobrante pasa a los demas', () => {
    expect(allocate(10, [1, 20, 20], [1, 1, 1])).toEqual([1, 5, 4]);
    expect(allocate(10, [2, 2, 20], [1, 1, 1])).toEqual([2, 2, 6]);
  });
  it('si no alcanza, reparte todo lo que hay', () => {
    expect(allocate(50, [3, 4], [1, 1])).toEqual([3, 4]);
  });
  it('casos borde: nada que repartir, pesos cero o negativos', () => {
    expect(allocate(0, [5, 5], [1, 1])).toEqual([0, 0]);
    expect(allocate(5, [], [])).toEqual([]);
    expect(allocate(6, [9, 9], [0, 0])).toEqual([3, 3]); // sin pesos utiles: por igual
    expect(allocate(6, [9, 9], [-5, 1])).toEqual([0, 6]);
  });
  it('propiedad: la suma es min(total, disponibles), nunca pasa del cupo y nadie sobra mientras otro falte (500 casos)', () => {
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
      const total = Math.floor(rng() * 30);
      const out = allocate(total, new Array(n).fill(100), new Array(n).fill(1));
      expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(1);
    }
  });
});

describe('composeExam: corte', () => {
  it('arma un examen de 10 con las preguntas de los modulos del corte, repartidas por igual', () => {
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'period', periodId: 'p1' }, rng: seeded(1) }));
    expect(r.questionIds).toHaveLength(DEFAULT_PERIOD_EXAM_SIZE);
    expect(r.perModule).toEqual({ R1: 5, R2: 5 });
    expect(r.questionIds.every((q) => q.startsWith('R1-') || q.startsWith('R2-'))).toBe(true);
  });
  it('NUNCA incluye preguntas de modulos de otros cortes', () => {
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'period', periodId: 'p2' }, rng: seeded(2) }));
    expect(r.questionIds.every((q) => q.startsWith('R3-'))).toBe(true);
  });
  it('sin repetidas y sin inventar: todo id sale del banco', () => {
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'period', periodId: 'p1' }, size: 20, rng: seeded(3) }));
    expect(new Set(r.questionIds).size).toBe(r.questionIds.length);
    const ids = new Set(BANK.map((q) => q.id));
    expect(r.questionIds.every((q) => ids.has(q))).toBe(true);
  });
  it('un banco con ids repetidos no mete la misma pregunta dos veces', () => {
    const dup = [...bankOf({ R1: 6, R2: 6 }), ...bankOf({ R1: 6, R2: 6 })];
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: dup, exam: { kind: 'period', periodId: 'p1' }, size: 12, rng: seeded(4) }));
    expect(new Set(r.questionIds).size).toBe(12);
  });
  it('solo entran tipos que el servidor califica (los minijuegos no)', () => {
    const mixed = [...bankOf({ R1: 6, R2: 6 }), ...bankOf({ R1: 20, R2: 20 }, 'ordenar_pasos'), ...bankOf({ R1: 20 }, 'cartas')];
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: mixed, exam: { kind: 'period', periodId: 'p1' }, size: 12, rng: seeded(5) }));
    expect(r.questionIds).toHaveLength(12);
    expect(r.questionIds.every((q) => /^R[12]-q\d$/.test(q))).toBe(true);
    for (const t of EXAM_QUESTION_TYPES) expect(['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match']).toContain(t);
  });
  it('un modulo con pocas preguntas aporta lo que tiene y el resto lo ponen los demas', () => {
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: bankOf({ R1: 2, R2: 30, R3: 5 }), exam: { kind: 'period', periodId: 'p1' }, rng: seeded(6) }));
    expect(r.perModule).toEqual({ R1: 2, R2: 8 });
  });
  it('si hay menos preguntas que el tamano, usa todas las que hay', () => {
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: bankOf({ R1: 3, R2: 4, R3: 9 }), exam: { kind: 'period', periodId: 'p1' }, rng: seeded(6) }));
    expect(r.questionIds).toHaveLength(7);
  });
  it('es reproducible con la misma semilla y cambia de orden con otra', () => {
    const a = ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'period', periodId: 'p1' }, rng: seeded(9) }));
    const b = ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'period', periodId: 'p1' }, rng: seeded(9) }));
    const c = ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'period', periodId: 'p1' }, rng: seeded(10) }));
    expect(a.questionIds).toEqual(b.questionIds);
    expect(c.questionIds).not.toEqual(a.questionIds);
  });
  it('el orden final esta mezclado (no queda agrupado por modulo)', () => {
    const orders = new Set<string>();
    for (let s = 0; s < 20; s++) orders.add(ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'period', periodId: 'p1' }, rng: seeded(s) })).questionIds.map((q) => q[1]).join(''));
    expect(orders.size).toBeGreaterThan(10);
  });
  it('un corte que no existe: error claro', () => {
    expect(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'period', periodId: 'nope' } })).toMatchObject({ ok: false, reason: 'noSuchPeriod' });
  });
});

describe('composeExam: lo que el examen NO puede comprobar no se salta en silencio', () => {
  it('un modulo del corte sin enlace: no se arma y se dice cual', () => {
    const r = composeExam({ plan: plan(), links: [LINKS[0], LINKS[2]], bank: BANK, exam: { kind: 'period', periodId: 'p1' } });
    expect(r).toMatchObject({ ok: false, reason: 'unlinked', missing: [{ nodeId: 'm2', title: 'Dos' }] });
  });
  it('un modulo enlazado sin preguntas calificables: no se arma y se dice cual', () => {
    const r = composeExam({ plan: plan(), links: LINKS, bank: bankOf({ R1: 10, R3: 10 }), exam: { kind: 'period', periodId: 'p1' } });
    expect(r).toMatchObject({ ok: false, reason: 'noQuestions', missing: [{ nodeId: 'm2', title: 'Dos' }] });
  });
  it('un modulo con SOLO minijuegos cuenta como sin preguntas', () => {
    const r = composeExam({ plan: plan(), links: LINKS, bank: [...bankOf({ R1: 10 }), ...bankOf({ R2: 10 }, 'ordenar_pasos')], exam: { kind: 'period', periodId: 'p1' } });
    expect(r).toMatchObject({ ok: false, reason: 'noQuestions' });
  });
  it('un hueco en OTRO corte no impide el examen de este', () => {
    ok(composeExam({ plan: plan(), links: [LINKS[0], LINKS[1]], bank: BANK, exam: { kind: 'period', periodId: 'p1' } }));
  });
  it('muy pocas preguntas en total: no se arma', () => {
    const r = composeExam({ plan: plan(), links: LINKS, bank: bankOf({ R1: 2, R2: 2, R3: 9 }), exam: { kind: 'period', periodId: 'p1' } });
    expect(r).toMatchObject({ ok: false, reason: 'tooFew' });
    expect(MIN_EXAM_QUESTIONS).toBe(5);
  });
  it('un plan sin modulos', () => {
    const p = plan();
    p.periods.forEach((x) => x.objectives.forEach((o) => (o.modules = [])));
    expect(composeExam({ plan: p, links: [], bank: BANK, exam: { kind: 'final' } })).toMatchObject({ ok: false, reason: 'noModules' });
  });
  it('filas del banco mal formadas se ignoran sin romper', () => {
    const junk: any[] = [null, undefined, {}, { id: 5, moduleId: 'R1', type: 'multiple_choice' }, { id: 'x', moduleId: 7, type: 'multiple_choice' }, { id: 'y', moduleId: 'R1', type: null }];
    ok(composeExam({ plan: plan(), links: LINKS, bank: [...BANK, ...junk], exam: { kind: 'period', periodId: 'p1' }, rng: seeded(1) }));
  });
});

describe('composeExam: evaluacion final', () => {
  it('toma de TODOS los cortes, por peso (40/60) y luego por modulo', () => {
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: bankOf({ R1: 10, R2: 10, R3: 30 }), exam: { kind: 'final' }, rng: seeded(1) }));
    expect(r.questionIds).toHaveLength(DEFAULT_FINAL_EXAM_SIZE);
    expect(r.perModule).toEqual({ R1: 4, R2: 4, R3: 12 }); // 8 del corte 1 (40 %) repartidas en 2 modulos y 12 del corte 2 (60 %)
  });
  it('si el modulo de un corte tiene pocas preguntas, el sobrante pasa a los demas cortes (la final sigue completa)', () => {
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'final' }, rng: seeded(1) })); // R3 solo tiene 10
    expect(r.questionIds).toHaveLength(DEFAULT_FINAL_EXAM_SIZE);
    expect(r.perModule).toEqual({ R1: 5, R2: 5, R3: 10 });
  });
  it('cubre todos los modulos (ninguno queda sin una sola pregunta)', () => {
    const r = ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'final' }, size: 6, rng: seeded(2) }));
    expect(Object.keys(r.perModule).sort()).toEqual(['R1', 'R2', 'R3']);
  });
  it('un hueco en cualquier corte impide la final', () => {
    expect(composeExam({ plan: plan(), links: [LINKS[0], LINKS[1]], bank: BANK, exam: { kind: 'final' } })).toMatchObject({ ok: false, reason: 'unlinked', missing: [{ nodeId: 'm3' }] });
  });
});

describe('composeExam: tamano', () => {
  it('respeta el tamano pedido y lo acota a [1, MAX]', () => {
    expect(ok(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'final' }, size: 12, rng: seeded(1) })).questionIds).toHaveLength(12);
    const big = bankOf({ R1: 100, R2: 100, R3: 100 });
    expect(ok(composeExam({ plan: plan(), links: LINKS, bank: big, exam: { kind: 'final' }, size: 9999, rng: seeded(1) })).questionIds).toHaveLength(MAX_EXAM_QUESTIONS);
    expect(composeExam({ plan: plan(), links: LINKS, bank: BANK, exam: { kind: 'final' }, size: -4 })).toMatchObject({ ok: false, reason: 'tooFew' });
  });
  it('propiedad: sin repetidas, dentro del banco, y nunca mas que el tamano (200 casos)', () => {
    const rng = seeded(21);
    for (let t = 0; t < 200; t++) {
      const bank = bankOf({ R1: 1 + Math.floor(rng() * 12), R2: 1 + Math.floor(rng() * 12), R3: 1 + Math.floor(rng() * 12) });
      const size = 5 + Math.floor(rng() * 25);
      const r = composeExam({ plan: plan(), links: LINKS, bank, exam: { kind: 'final' }, size, rng });
      if (!r.ok) continue;
      const ids = new Set(bank.map((q) => q.id));
      expect(new Set(r.questionIds).size).toBe(r.questionIds.length);
      expect(r.questionIds.every((q) => ids.has(q))).toBe(true);
      expect(r.questionIds.length).toBeLessThanOrEqual(size);
      expect(Object.values(r.perModule).reduce((a, b) => a + b, 0)).toBe(r.questionIds.length);
    }
  });
  it('no cambia sus entradas', () => {
    const p = plan();
    const before = JSON.stringify([p, LINKS, BANK]);
    composeExam({ plan: p, links: LINKS, bank: BANK, exam: { kind: 'final' }, rng: seeded(1) });
    expect(JSON.stringify([p, LINKS, BANK])).toBe(before);
  });
});

describe('aleatoriedad y robustez', () => {
  it('shuffle es una permutacion (no pierde ni repite) y puede dejar un elemento en su sitio (no es un ciclo forzado)', () => {
    let fixed = 0;
    for (let s = 0; s < 300; s++) {
      const out = shuffle([0, 1, 2, 3, 4], seeded(s));
      expect([...out].sort()).toEqual([0, 1, 2, 3, 4]);
      if (out.some((x, i) => x === i)) fixed++;
    }
    expect(fixed).toBeGreaterThan(100); // con un algoritmo sesgado (Sattolo) seria 0
  });
  it('shuffle da todas las posiciones a cada elemento, con frecuencias parecidas', () => {
    const pos = [0, 0, 0, 0];
    for (let s = 0; s < 2000; s++) pos[shuffle([0, 1, 2, 3], seeded(s)).indexOf(0)]++;
    for (const n of pos) expect(n).toBeGreaterThan(380); // ideal 500
  });
  it('de un modulo con mas preguntas que su cupo se eligen DISTINTAS segun el azar (no siempre las primeras)', () => {
    const chosen = new Set<string>();
    for (let s = 0; s < 40; s++) for (const q of ok(composeExam({ plan: plan(), links: LINKS, bank: bankOf({ R1: 20, R2: 20, R3: 20 }), exam: { kind: 'period', periodId: 'p1' }, rng: seeded(s) })).questionIds) chosen.add(q);
    expect(chosen.size).toBeGreaterThan(30); // de 40 posibles; si siempre fueran las 5 primeras de cada modulo serian 10
  });
  it('si un mismo modulo real estuviera enlazado a dos nodos, no se repite ninguna pregunta y las cuentas cuadran', () => {
    const twice = [{ nodeId: 'm1', moduleId: 'R1' }, { nodeId: 'm2', moduleId: 'R1' }, { nodeId: 'm3', moduleId: 'R3' }];
    const r = ok(composeExam({ plan: plan(), links: twice, bank: bankOf({ R1: 12, R3: 12 }), exam: { kind: 'period', periodId: 'p1' }, size: 10, rng: seeded(3) }));
    expect(new Set(r.questionIds).size).toBe(r.questionIds.length);
    expect(Object.values(r.perModule).reduce((a, b) => a + b, 0)).toBe(r.questionIds.length);
  });
});
