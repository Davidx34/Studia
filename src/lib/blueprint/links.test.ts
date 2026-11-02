import { describe, expect, it } from 'vitest';
import { checkLinks, coverage, MAX_LINKS, planModules, similarity, suggestLinks, SUGGEST_MIN, tokens } from './links';
import type { Blueprint } from './types';

const bp = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'x' }],
  periods: [
    { id: 'p1', name: 'Primer corte', order: 1, weight: 50, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'Elasticidad', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Concepto de elasticidad', order: 1 }, { id: 'm2', title: 'Calculo de la elasticidad precio', order: 2 }] }] },
    { id: 'p2', name: 'Segundo corte', order: 2, weight: 50, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob2', title: 'Equilibrio', outcomeIds: ['o1'], modules: [{ id: 'm3', title: 'Oferta y demanda', order: 1 }] }] },
  ],
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REAL = [
  { id: id(1), title: 'Elasticidad: concepto' },
  { id: id(2), title: 'Oferta y Demanda' },
  { id: id(3), title: 'Calculo de la elasticidad precio de la demanda' },
  { id: id(4), title: 'Historia del pensamiento economico' },
];

describe('planModules', () => {
  it('lista los modulos en orden de recorrido, con su corte y objetivo', () => {
    expect(planModules(bp()).map((m) => [m.nodeId, m.periodName, m.objectiveTitle])).toEqual([
      ['m1', 'Primer corte', 'Elasticidad'],
      ['m2', 'Primer corte', 'Elasticidad'],
      ['m3', 'Segundo corte', 'Equilibrio'],
    ]);
  });
});

describe('tokens y similarity', () => {
  it('normaliza mayusculas, tildes, signos y quita palabras vacias y repetidas', () => {
    expect(tokens('  Cálculo DE la Elasticidad: elasticidad!! ')).toEqual(['calculo', 'elasticidad']);
    expect(tokens('Introducción a la unidad')).toEqual([]);
  });
  it('titulos iguales (sin importar tildes/mayusculas) valen 1; sin nada en comun, 0', () => {
    expect(similarity('Oferta y demanda', 'OFERTA Y DEMANDA')).toBe(1);
    expect(similarity('Cálculo', 'calculo')).toBe(1);
    expect(similarity('Oferta', 'Historia')).toBe(0);
  });
  it('es simetrica y esta entre 0 y 1', () => {
    const a = 'Concepto de elasticidad';
    const b = 'Elasticidad: concepto y ejemplos';
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 10);
    expect(similarity(a, b)).toBeGreaterThan(0);
    expect(similarity(a, b)).toBeLessThanOrEqual(1);
  });
  it('un titulo hecho solo de palabras vacias no se parece a nada (ni a si mismo)', () => {
    expect(similarity('Introduccion', 'Introduccion')).toBe(0);
    expect(similarity('', 'algo')).toBe(0);
  });
});

describe('suggestLinks', () => {
  it('sugiere por parecido de titulo, uno a uno, y no por debajo del umbral', () => {
    const s = suggestLinks(bp(), REAL);
    expect(s.map((x) => [x.nodeId, x.moduleId])).toEqual([
      ['m1', id(1)], // mismas palabras en otro orden: 1,0 (empata con m3; gana el orden del plan)
      ['m3', id(2)], // identico: 1,0
      ['m2', id(3)], // 0,75
    ]);
    expect(s.every((x) => x.score >= SUGGEST_MIN && x.score <= 1)).toBe(true);
    expect(s.find((x) => x.moduleId === id(4))).toBeUndefined(); // "Historia..." no se parece a nada
  });
  it('un modulo real nunca se sugiere para dos nodos', () => {
    const plan = bp();
    plan.periods[0].objectives[0].modules.push({ id: 'm9', title: 'Oferta y demanda', order: 3 });
    const s = suggestLinks(plan, REAL);
    expect(s.filter((x) => x.moduleId === id(2))).toHaveLength(1);
    expect(new Set(s.map((x) => x.nodeId)).size).toBe(s.length);
  });
  it('en un empate gana el orden del plan (resultado estable)', () => {
    const plan = bp();
    plan.periods[1].objectives[0].modules.push({ id: 'm9', title: 'Oferta y demanda', order: 2 });
    const s = suggestLinks(plan, [{ id: id(2), title: 'Oferta y demanda' }]);
    expect(s).toEqual([{ nodeId: 'm3', moduleId: id(2), score: 1 }]); // m3 va antes que m9 en el recorrido
  });
  it('no toca lo que ya esta enlazado: ni nodos ni modulos usados', () => {
    const s = suggestLinks(bp(), REAL, [{ nodeId: 'm3', moduleId: id(2) }]);
    expect(s.map((x) => x.nodeId)).not.toContain('m3');
    expect(s.map((x) => x.moduleId)).not.toContain(id(2));
    const s2 = suggestLinks(bp(), REAL, [{ nodeId: 'm1', moduleId: id(2) }]);
    expect(s2.find((x) => x.nodeId === 'm3')).toBeUndefined(); // su modulo "Oferta y Demanda" ya esta usado por otro nodo
  });
  it('un parecido debil (por debajo del umbral) no se sugiere', () => {
    const plan = bp();
    // "Calculo de la elasticidad precio" vs un titulo que solo comparte "calculo": parecido > 0 pero < 0,5
    expect(similarity('Calculo de la elasticidad precio', 'Historia economica y calculo avanzado')).toBeGreaterThan(0);
    expect(similarity('Calculo de la elasticidad precio', 'Historia economica y calculo avanzado')).toBeLessThan(SUGGEST_MIN);
    expect(suggestLinks(plan, [{ id: id(7), title: 'Historia economica y calculo avanzado' }])).toEqual([]);
  });
  it('un nodo recibe a lo sumo UNA sugerencia aunque varios modulos reales se le parezcan', () => {
    const s = suggestLinks(bp(), [{ id: id(2), title: 'Oferta y Demanda' }, { id: id(5), title: 'Oferta y demanda' }]);
    expect(s.filter((x) => x.nodeId === 'm3')).toHaveLength(1);
  });
  it('un nodo ya enlazado a OTRO modulo no recibe sugerencia', () => {
    const s = suggestLinks(bp(), REAL, [{ nodeId: 'm3', moduleId: id(4) }]);
    expect(s.find((x) => x.nodeId === 'm3')).toBeUndefined();
    expect(s.find((x) => x.moduleId === id(2))).toBeUndefined(); // sin dueno: "Oferta y Demanda" no se le da a otro nodo parecido
  });
  it('sin modulos reales o sin plan: nada', () => {
    expect(suggestLinks(bp(), [])).toEqual([]);
    expect(suggestLinks({ ...bp(), periods: [] }, REAL)).toEqual([]);
  });
  it('no cambia sus entradas', () => {
    const plan = bp();
    const before = JSON.stringify([plan, REAL]);
    suggestLinks(plan, REAL);
    expect(JSON.stringify([plan, REAL])).toBe(before);
  });
});

describe('checkLinks: lo que llega del navegador no es confiable', () => {
  const classModules = [id(1), id(2), id(3)];
  const ok = (raw: unknown) => checkLinks(raw, bp(), classModules);
  it('acepta enlaces validos y devuelve copias limpias (sin campos extra)', () => {
    const r = ok([{ nodeId: 'm1', moduleId: id(1), extra: 'x', __proto__: { a: 1 } }, { nodeId: 'm3', moduleId: id(2) }]);
    expect(r).toEqual({ ok: true, links: [{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm3', moduleId: id(2) }] });
  });
  it('una lista vacia es valida (desenlazar todo)', () => {
    expect(ok([])).toEqual({ ok: true, links: [] });
  });
  it('rechaza lo que no es una lista', () => {
    for (const bad of [null, undefined, 'x', 5, {}, { length: 1 }]) expect(ok(bad).ok).toBe(false);
  });
  it('rechaza elementos mal formados', () => {
    for (const bad of [[null], [5], [[]], [{}], [{ nodeId: 'm1' }], [{ moduleId: id(1) }], [{ nodeId: 5, moduleId: id(1) }], [{ nodeId: 'm1', moduleId: 7 }]]) expect(ok(bad).ok, JSON.stringify(bad)).toBe(false);
  });
  it('rechaza un modulo del plan que no existe (incluidos ids de objetivo, de corte o de comprension)', () => {
    for (const node of ['nope', 'ob1', 'p1', 'o1', '__proto__', '']) {
      const r = ok([{ nodeId: node, moduleId: id(1) }]);
      expect(r.ok, node).toBe(false);
    }
  });
  it('rechaza un modulo real que no es de la clase, o que no es un uuid', () => {
    expect(ok([{ nodeId: 'm1', moduleId: id(99) }]).ok).toBe(false);
    expect(ok([{ nodeId: 'm1', moduleId: 'no-es-uuid' }]).ok).toBe(false);
    expect(ok([{ nodeId: 'm1', moduleId: "' OR 1=1 --" }]).ok).toBe(false);
  });
  it('rechaza repetidos: un nodo dos veces, o un modulo real para dos nodos', () => {
    expect(ok([{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm1', moduleId: id(2) }]).ok).toBe(false);
    expect(ok([{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm2', moduleId: id(1) }]).ok).toBe(false);
  });
  it('rechaza listas gigantes sin recorrerlas', () => {
    const huge = new Array(MAX_LINKS + 1).fill({ nodeId: 'm1', moduleId: id(1) });
    const r = ok(huge);
    expect(!r.ok && r.errors).toHaveLength(1);
  });
  it('informa varios problemas a la vez, con su posicion, y no mas de 20', () => {
    const r = ok([{ nodeId: 'nope', moduleId: id(1) }, { nodeId: 'm1', moduleId: id(99) }]);
    expect(!r.ok && r.errors).toEqual([expect.stringContaining('links[0]'), expect.stringContaining('links[1]')]);
    const many = ok(new Array(50).fill({ nodeId: 'nope', moduleId: id(1) }));
    expect(!many.ok && many.errors.length).toBe(20);
  });
});

describe('coverage', () => {
  it('cuenta lo enlazado y lista lo pendiente en orden', () => {
    const c = coverage(bp(), [{ nodeId: 'm2', moduleId: id(1) }]);
    expect(c.linked).toBe(1);
    expect(c.total).toBe(3);
    expect(c.pending.map((m) => m.nodeId)).toEqual(['m1', 'm3']);
  });
  it('sin enlaces, todo pendiente; con todo enlazado, nada pendiente', () => {
    expect(coverage(bp(), []).linked).toBe(0);
    expect(coverage(bp(), [{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm2', moduleId: id(2) }, { nodeId: 'm3', moduleId: id(3) }]).pending).toEqual([]);
  });
  it('un enlace a un nodo que ya no existe no cuenta como cubierto', () => {
    expect(coverage(bp(), [{ nodeId: 'fantasma', moduleId: id(1) }]).linked).toBe(0);
  });
});
