import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { Expr, MODEL_LIMITS, evaluateModel, templateFromModel, validateModel } from './model';
import { buildLab, resolveLab, templateOfSpec, validateLabSpec } from './labSpec';
import { MODEL_EXAMPLES } from './modelExamples';
import { buildInitMessage } from './protocol';
import { isPublicAsset } from '@/lib/auth/routes';
import type { LabModel } from './types';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const req = createRequire(path.join(root, 'package.json'));

const calc = (src: string, env: Record<string, number> = {}) => {
  const c = Expr.compile(src, Object.keys(env));
  if (!c.ok) throw new Error(c.error);
  return c.fn(env);
};
const fails = (src: string, env: Record<string, number> = {}) => {
  const c = Expr.compile(src, Object.keys(env));
  return c.ok ? null : c.error;
};

const example = (id: string) => MODEL_EXAMPLES.find((e) => e.id === id)!;
const valid = (id: string): LabModel => {
  const r = validateModel(example(id).raw);
  if (!r.ok) throw new Error(r.errors.join(' | '));
  return r.model;
};
const constantsOf = (m: LabModel, over: Record<string, number> = {}) => Object.fromEntries(m.constants.map((c) => [c.id, over[c.id] ?? c.value]));

// ─────────────────────────── el evaluador ───────────────────────────
describe('evaluador de formulas', () => {
  it('precedencia y asociatividad como en matematicas', () => {
    expect(calc('2+3*4')).toBe(14);
    expect(calc('(2+3)*4')).toBe(20);
    expect(calc('-2^2')).toBe(-4);
    expect(calc('2^3^2')).toBe(512);
    expect(calc('2^-1')).toBe(0.5);
    expect(calc('10-4-3')).toBe(3);
    expect(calc('100/10/5')).toBe(2);
    expect(calc('7%4')).toBe(3);
    expect(calc('-x+3', { x: 5 })).toBe(-2);
    expect(calc('2*-3')).toBe(-6);
  });

  it('numeros con decimales y notacion cientifica; pi y e', () => {
    expect(calc('1.5e3')).toBe(1500);
    expect(calc('.5+0.25')).toBe(0.75);
    expect(calc('2E-2')).toBe(0.02);
    expect(calc('pi')).toBe(Math.PI);
    expect(calc('ln(e)')).toBe(1);
  });

  it('funciones: coinciden con Math y respetan su aridad', () => {
    expect(calc('sqrt(16)+abs(-3)')).toBe(7);
    expect(calc('min(4,2,9)')).toBe(2);
    expect(calc('max(4,2,9,11)')).toBe(11);
    expect(calc('pow(2,10)')).toBe(1024);
    expect(calc('clamp(15,0,10)')).toBe(10);
    expect(calc('mod(-1,5)')).toBe(4);
    expect(calc('log10(1000)')).toBeCloseTo(3, 12);
    expect(calc('atan2(1,1)')).toBeCloseTo(Math.PI / 4, 12);
    expect(fails('sqrt(1,2)')).toMatch(/necesita 1/);
    expect(fails('min(1)')).toMatch(/necesita 2 a 4/);
    expect(fails('if(1,2)')).toMatch(/necesita 3/);
  });

  it('comparaciones y logica devuelven 1 o 0; if es perezoso (no evalua la rama que no se usa)', () => {
    expect(calc('3>2')).toBe(1);
    expect(calc('3<=2')).toBe(0);
    expect(calc('2==2 && 3!=3')).toBe(0);
    expect(calc('0 || 5>1')).toBe(1);
    expect(calc('!0')).toBe(1);
    expect(calc('if(x>0, 1/x, 0)', { x: 0 })).toBe(0);
    expect(calc('if(x>0, 1/x, 0)', { x: 4 })).toBe(0.25);
  });

  it('un error de dominio da NaN o infinito (lo atrapa la validacion), no una excepcion', () => {
    expect(calc('sqrt(-1)')).toBeNaN();
    expect(calc('1/0')).toBe(Infinity);
    expect(calc('ln(0)')).toBe(-Infinity);
  });

  it('errores en espanol y con la causa: multiplicacion implicita, nombres, funciones, simbolos', () => {
    expect(fails('2x', { x: 1 })).toMatch(/Falta el signo \*/);
    expect(fails('2(3)')).toMatch(/Falta el signo \*/);
    expect(fails('x y', { x: 1, y: 1 })).toMatch(/Sobra algo/);
    expect(fails('foo(1)')).toMatch(/La función "foo" no existe/);
    expect(fails('z+1', { x: 1 })).toMatch(/"z" no está declarado/);
    expect(fails('sqrt+1')).toMatch(/es una función/);
    expect(fails('x+')).toMatch(/inesperada/);
    expect(fails('(1+2')).toMatch(/Se esperaba "\)"/);
    expect(fails('1 ; 2')).toMatch(/no permitido/);
    expect(fails('a.b', { a: 1, b: 1 })).toMatch(/no permitido|Sobra/);
    expect(fails('')).toMatch(/vacía/);
    expect(fails('   ')).toMatch(/vacía/);
  });

  it('topes: largo, cantidad de elementos y parentesis anidados', () => {
    expect(fails('1+'.repeat(130) + '1')).toMatch(/demasiado larga/);
    expect(fails(Array.from({ length: 160 }, () => '1').join('+'))).toMatch(/demasiado/);
    expect(fails('('.repeat(40) + '1' + ')'.repeat(40))).toMatch(/anidados/);
    expect(fails('-'.repeat(40) + '1')).toMatch(/anidados/);
    expect(fails('2^'.repeat(40) + '2')).toMatch(/anidados/);
    // lo razonable pasa
    expect(calc('('.repeat(20) + '1' + ')'.repeat(20))).toBe(1);
  });

  it('nombres de la cadena de prototipos (constructor, toString, __proto__...) NO son nombres declarados', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'prototype']) {
      expect(fails(name, { x: 1 }), name).toMatch(/no está declarado/);
    }
    // y un entorno con esos nombres como DATOS no filtra nada
    const m = Expr.compileModel({ variables: [{ id: 'x' }], constants: [], derived: [], outputs: [{ id: 'y', expr: 'x+1' }] });
    expect(m.ok).toBe(true);
  });

  it('entrada hostil o basura nunca lanza excepciones ni ejecuta nada (fuzz determinista)', () => {
    const alphabet = ['x', 'y', '1', '2.5', '+', '-', '*', '/', '^', '%', '(', ')', ',', '<', '>', '=', '!', '&&', '||', 'sqrt', 'if', 'max', ' ', 'constructor', '.', ';', '`', '${', '"', "'", '\\', 'alert(1)', 'while', 'function', '=>', '[', ']', '{', '}', 'this', 'globalThis', 'process'];
    let s = 987654321;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 4000; i++) {
      const n = 1 + Math.floor(rnd() * 14);
      const src = Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join(rnd() < 0.5 ? '' : ' ');
      expect(() => Expr.compile(src, ['x', 'y']), src).not.toThrow();
      const c = Expr.compile(src, ['x', 'y']);
      if (c.ok) expect(() => c.fn({ x: 2, y: 3 }), src).not.toThrow();
    }
  });

  it('formulas que parecen codigo no se ejecutan: son errores', () => {
    for (const src of ['alert(1)', 'process.exit()', 'globalThis', 'x=1', 'x;1', '`${1}`', '"a"', "'a'", 'function(){}', '(()=>1)()', 'x[0]', 'x.y', 'this']) {
      expect(fails(src, { x: 1 }), src).not.toBeNull();
    }
  });
});

// ─────────────────────────── el compilador de modelos ───────────────────────────
describe('compileModel', () => {
  const base = { variables: [{ id: 'x' }], constants: [{ id: 'k' }], derived: [{ id: 'd', expr: 'x*k' }], outputs: [{ id: 'y', expr: 'd+1' }] };

  it('calcula en orden: pasos y salidas ven lo declarado antes', () => {
    const c = Expr.compileModel(base);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.run({ x: 3 }, { k: 2 }).y).toBe(7);
  });

  it('una salida no puede usar algo declarado DESPUES (no hay ciclos posibles)', () => {
    const r = Expr.compileModel({ ...base, outputs: [{ id: 'y', expr: 'z+1' }, { id: 'z', expr: 'x' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/"z" no está declarado/);
    const self = Expr.compileModel({ ...base, outputs: [{ id: 'y', expr: 'y+1' }] });
    expect(self.ok).toBe(false);
  });

  it('nombres repetidos, reservados o mal formados', () => {
    const msg = (m: unknown) => {
      const r = Expr.compileModel(m);
      return r.ok ? '' : r.errors.join(' ');
    };
    expect(msg({ ...base, derived: [{ id: 'x', expr: '1' }] })).toMatch(/repetido/);
    expect(msg({ ...base, derived: [{ id: 'sqrt', expr: '1' }] })).toMatch(/reservada/);
    expect(msg({ ...base, derived: [{ id: 'pi', expr: '1' }] })).toMatch(/reservada/);
    expect(msg({ ...base, derived: [{ id: 'param', expr: '1' }] })).toMatch(/reservada/);
    expect(msg({ ...base, derived: [{ id: '1abc', expr: '1' }] })).toMatch(/no es válido/);
    expect(msg({ ...base, derived: [{ id: 'a b', expr: '1' }] })).toMatch(/no es válido/);
  });

  it('la escena ve todo mas "param"; los puntos no ven "param"', () => {
    const ok = Expr.compileModel({ ...base, scene: { curves: [{ kind: 'param', x: 'param', y: 'param*k', from: '0', to: 'x' }], points: [{ x: 'x', y: 'y' }] } });
    expect(ok.ok).toBe(true);
    const bad = Expr.compileModel({ ...base, scene: { curves: [], points: [{ x: 'param', y: 'y' }] } });
    expect(bad.ok).toBe(false);
    const noOut = Expr.compileModel({ ...base, scene: { curves: [{ kind: 'sweep', output: 'nada' }], points: [] } });
    expect(noOut.ok).toBe(false);
  });

  it('un valor de "values" o "constants" con nombre peligroso no toca el prototipo', () => {
    const c = Expr.compileModel(base);
    if (!c.ok) throw new Error('x');
    const evil = JSON.parse('{"x":1,"__proto__":{"polluted":true}}');
    c.run(evil, { k: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ─────────────────────────── validacion numerica ───────────────────────────
describe('validateModel', () => {
  const ok = (over: Record<string, unknown>) => ({
    variables: [{ id: 'x', min: 0, max: 10, default: 5 }],
    constants: [],
    derived: [],
    outputs: [{ id: 'y', expr: 'x*2' }],
    ...over,
  });
  const errs = (raw: unknown) => {
    const r = validateModel(raw);
    return r.ok ? [] : r.errors;
  };

  it('los 3 modelos de ejemplo son validos', () => {
    for (const e of MODEL_EXAMPLES) {
      const r = validateModel(e.raw);
      expect(r.ok, `${e.id}: ${r.ok ? '' : r.errors.join(' | ')}`).toBe(true);
    }
  });

  it('rechaza una salida que se indefine en el rango (division por cero) y dice DONDE', () => {
    const e = errs(ok({ variables: [{ id: 'x', min: 0, max: 10 }], outputs: [{ id: 'y', expr: '1/x' }] }));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/"y" no es un número razonable/);
    expect(e[0]).toContain('x = 0');
    expect(e[0]).toMatch(/max\(\.\.\.\) o if\(\.\.\.\)/);
  });

  it('rechaza raices de negativos y logaritmos de cero dentro del rango', () => {
    expect(errs(ok({ outputs: [{ id: 'y', expr: 'sqrt(x-5)' }] }))[0]).toMatch(/NaN/);
    expect(errs(ok({ outputs: [{ id: 'y', expr: 'ln(x)' }] }))[0]).toMatch(/-Infinity/);
  });

  it('rechaza una salida que explota (mas de mil millones)', () => {
    expect(errs(ok({ variables: [{ id: 'x', min: 0, max: 100 }], outputs: [{ id: 'y', expr: 'exp(x)' }] }))[0]).toMatch(/no es un número razonable/);
  });

  it('protegida con max/if si pasa', () => {
    expect(validateModel(ok({ variables: [{ id: 'x', min: 0, max: 10 }], outputs: [{ id: 'y', expr: 'if(x>0, 1/x, 0)' }] })).ok).toBe(true);
    expect(validateModel(ok({ outputs: [{ id: 'y', expr: 'sqrt(max(x-5, 0))' }] })).ok).toBe(true);
  });

  it('prueba tambien las constantes en sus extremos (no solo su valor inicial)', () => {
    const e = errs(ok({ constants: [{ id: 'k', value: 2, min: 0, max: 4 }], outputs: [{ id: 'y', expr: 'x/k' }] }));
    expect(e[0]).toMatch(/k = 0/);
  });

  it('reporta cada salida mala una sola vez', () => {
    const e = errs(ok({ variables: [{ id: 'x', min: 0, max: 10 }], outputs: [{ id: 'a', expr: '1/x' }, { id: 'b', expr: 'ln(x)' }, { id: 'c', expr: 'x' }] }));
    expect(e).toHaveLength(2);
  });

  it('formulas con errores de sintaxis o nombres: mensajes claros', () => {
    expect(errs(ok({ outputs: [{ id: 'y', expr: '2x' }] }))[0]).toMatch(/Salida "y": Falta el signo/);
    expect(errs(ok({ outputs: [{ id: 'y', expr: 'x*zeta' }] }))[0]).toMatch(/"zeta" no está declarado/);
    expect(errs(ok({ derived: [{ id: 'd', expr: 'foo(x)' }] }))[0]).toMatch(/Paso "d"/);
  });

  it('forma: variables, salidas, rangos, pasos', () => {
    expect(errs(null)[0]).toMatch(/objeto/);
    expect(errs(ok({ variables: [] }))[0]).toMatch(/al menos una variable/);
    expect(errs(ok({ outputs: [] }))[0]).toMatch(/al menos una salida/);
    expect(errs(ok({ variables: [{ id: 'x', min: 5, max: 5 }] }))[0]).toMatch(/min < max/);
    expect(errs(ok({ variables: [{ id: 'x', min: 0, max: 1e9 }] }))[0]).toMatch(/demasiado grande/);
    expect(errs(ok({ variables: [{ id: 'x', min: 0, max: 100, step: 0.0001 }] }))[0]).toMatch(/paso es demasiado pequeño/);
    expect(errs(ok({ variables: Array.from({ length: MODEL_LIMITS.variables + 1 }, (_, i) => ({ id: `v${i}`, min: 0, max: 1 })) }))[0]).toMatch(/Máximo 5 variables/);
    expect(errs(ok({ outputs: Array.from({ length: MODEL_LIMITS.outputs + 1 }, (_, i) => ({ id: `o${i}`, expr: 'x' })) }))[0]).toMatch(/Máximo 6 salidas/);
    expect(errs(ok({ variables: [{ id: 'bad id', min: 0, max: 1 }] })).length).toBeGreaterThan(0);
  });

  it('completa lo que falta y ajusta lo que se sale, avisando', () => {
    const r = validateModel(ok({ variables: [{ id: 'x', label: '<b>Cantidad</b>', min: 0, max: 10, default: 99 }], outputs: [{ id: 'y', expr: 'x' }], independent: 'nada', area: 'inventada' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.model.variables[0];
    expect(v.default).toBe(10);
    expect(v.step).toBeGreaterThan(0);
    expect(v.label).toBe('Cantidad');
    expect(r.model.independent).toBe('x');
    expect(r.model.area).toBe('matematicas');
    expect(r.warnings.join(' ')).toMatch(/fuera de su rango/);
    expect(r.warnings.join(' ')).toMatch(/"nada" no existe/);
  });

  it('constantes: rango que no incluye el valor se ajusta', () => {
    const r = validateModel(ok({ constants: [{ id: 'k', value: 50, min: 0, max: 10 }], outputs: [{ id: 'y', expr: 'x+k' }] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.model.constants[0].max).toBeGreaterThanOrEqual(50);
      expect(r.warnings.join(' ')).toMatch(/constante "k"/);
    }
  });

  it('la escena: curvas que no dibujan nada o con from >= to se rechazan; puntos no finitos tambien', () => {
    const scene = (c: unknown, p: unknown[] = []) => ok({ scene: { curves: [c], points: p } });
    expect(errs(scene({ kind: 'param', x: 'param', y: 'param', from: '5', to: '1' }))[0]).toMatch(/from < to/);
    expect(errs(scene({ kind: 'param', x: 'param', y: 'sqrt(0-param-1)', from: '0', to: '5' }))[0]).toMatch(/no dibuja nada/);
    expect(errs(scene({ kind: 'sweep', output: 'y' }, [{ x: 'x', y: 'sqrt(0-1)' }]))[0]).toMatch(/punto 1/);
    expect(errs(scene({ kind: 'raro' }))[0]).toMatch(/usa kind "sweep"/);
    expect(validateModel(scene({ kind: 'param', x: 'param', y: 'param*2', from: '0', to: 'x' })).ok).toBe(true);
  });

  it('textos largos y con HTML se limpian; los topes de basis y concepto se respetan', () => {
    const r = validateModel(ok({ concept: '<script>x</script>' + 'c'.repeat(500), basis: ['<b>Uno</b>', '', ...Array.from({ length: 10 }, (_, i) => `b${i}`)] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.concept.length).toBeLessThanOrEqual(MODEL_LIMITS.concept);
    expect(r.model.concept).not.toMatch(/[<>]/);
    expect(r.model.basis).toHaveLength(MODEL_LIMITS.basis);
    expect(r.model.basis[0]).toBe('Uno');
  });

  it('es determinista (mismos puntos de prueba siempre)', () => {
    const a = validateModel(example('consumidor').raw);
    const b = validateModel(example('consumidor').raw);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('un modelo gigante se rechaza', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, expr: `x+${'1+'.repeat(100)}1` }));
    const r = validateModel(ok({ derived: many, outputs: many.map((d, i) => ({ id: `o${i}`, expr: d.expr, label: 'L'.repeat(60) })).slice(0, 6), basis: Array.from({ length: 6 }, () => 'b'.repeat(80)), concept: 'c'.repeat(200) }));
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────── la ciencia esta bien (valores conocidos) ───────────────────────────
describe('los modelos de ejemplo dan lo que dice la teoria', () => {
  it('consumidor: el optimo de la utilidad esta en x* = a·M/px (lo descubre el estudiante moviendo x)', () => {
    const m = valid('consumidor');
    for (const [over, xStar] of [[{}, 10], [{ a: 0.3, M: 200, px: 4 }, 15], [{ a: 0.8, M: 300, px: 10 }, 24], [{ a: 0.5, M: 100, px: 2 }, 25]] as [Record<string, number>, number][]) {
      const c = constantsOf(m, over);
      let best = { x: 0, u: -1 };
      for (let x = 0.5; x <= 40; x += 0.5) {
        const u = evaluateModel(m, { x }, c).U;
        if (u > best.u) best = { x, u };
      }
      expect(best.x, JSON.stringify(over)).toBe(xStar);
    }
  });

  it('consumidor: en el optimo, TMS = px/py y el gasto agota el presupuesto', () => {
    const m = valid('consumidor');
    const c = constantsOf(m);
    const o = evaluateModel(m, { x: 10 }, c);
    expect(o.Y).toBeCloseTo(12.5, 10);
    expect(o.U).toBeCloseTo(Math.sqrt(125), 10);
    expect(o.TMS).toBeCloseTo(c.px / c.py, 10);
    expect(10 * c.px + o.Y * c.py).toBeCloseTo(c.M, 10);
  });

  it('consumidor: si x agota el presupuesto no hay Y ni utilidad (sin NaN)', () => {
    const m = valid('consumidor');
    const o = evaluateModel(m, { x: 40 }, constantsOf(m)); // 40*5 = 200 > 100
    expect(o.Y).toBe(0);
    expect(o.U).toBe(0);
  });

  it('impuesto: sin impuesto, equilibrio P=30 y Q=40; con t=3, P=31, Q=38, recaudo 114 y perdida 3', () => {
    const m = valid('impuesto');
    const c = constantsOf(m);
    const a = evaluateModel(m, { t: 0 }, c);
    expect(a.P).toBeCloseTo(30, 10);
    expect(a.Q).toBeCloseTo(40, 10);
    expect(a.recaudo).toBe(0);
    expect(a.perdida).toBe(0);
    const b = evaluateModel(m, { t: 3 }, c);
    expect(b.P).toBeCloseTo(31, 10);
    expect(b.Q).toBeCloseTo(38, 10);
    expect(b.recibido).toBeCloseTo(28, 10);
    expect(b.recaudo).toBeCloseTo(114, 10);
    expect(b.perdida).toBeCloseTo(3, 10);
  });

  it('impuesto: el consumidor paga mas, el productor recibe menos y la cantidad cae (nunca negativa)', () => {
    const m = valid('impuesto');
    const c = constantsOf(m);
    let prev = evaluateModel(m, { t: 0 }, c);
    for (let t = 0.5; t <= 10; t += 0.5) {
      const o = evaluateModel(m, { t }, c);
      expect(o.P).toBeGreaterThanOrEqual(prev.P);
      expect(o.recibido).toBeLessThanOrEqual(prev.recibido);
      expect(o.Q).toBeLessThanOrEqual(prev.Q);
      expect(o.Q).toBeGreaterThanOrEqual(0);
      prev = o;
    }
  });

  it('poblacion: N(0)=N0, tiende a K, y N(30) con r=0.2, K=500, N0=10 es 445.85', () => {
    const m = valid('poblacion');
    const c = constantsOf(m);
    expect(evaluateModel(m, { r: 0.2, K: 500, tiempo: 0 }, c).N).toBeCloseTo(10, 10);
    expect(evaluateModel(m, { r: 0.5, K: 500, tiempo: 60 }, c).N).toBeCloseTo(500, 4);
    expect(evaluateModel(m, { r: 0.2, K: 500, tiempo: 30 }, c).N).toBeCloseTo(500 / (1 + 49 * Math.exp(-6)), 8);
    // el crecimiento es maximo cuando N = K/2
    const mid = evaluateModel(m, { r: 0.2, K: 500, tiempo: Math.log(49) / 0.2 }, c);
    expect(mid.N).toBeCloseTo(250, 6);
    expect(mid.crecimiento).toBeCloseTo((0.2 * 500) / 4, 6);
  });
});

// ─────────────────────────── integracion con la ficha ───────────────────────────
describe('ficha de un laboratorio a la medida', () => {
  const raw = (over: Record<string, unknown> = {}) => ({ template: 'modelo', title: 'El consumidor y su presupuesto', objective: '¿Qué cantidad de X maximiza la utilidad con este presupuesto?', model: example('consumidor').raw, ...over });

  it('se valida y se resuelve como una plantilla mas, llevando el modelo', () => {
    const r = buildLab(raw());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lab.template).toBe('modelo');
    expect(r.lab.model?.outputs.map((o) => o.id)).toEqual(['Y', 'U', 'TMS']);
    expect(r.lab.variables[0]).toMatchObject({ id: 'x', role: 'independiente', locked: false });
    expect(r.lab.constants.map((c) => c.id)).toEqual(['M', 'px', 'py', 'a']);
    expect(r.lab.chart).toEqual({ x: 'x', y: 'U' });
    expect(r.lab.outputs.map((o) => o.id)).toEqual(['Y', 'U', 'TMS']);
    expect(r.spec.model).toBeDefined();
  });

  it('el profesor puede ajustar constantes y rangos, siempre dentro de los limites del modelo', () => {
    const r = buildLab(raw({ constants: { M: 99999, px: 7 }, variables: { x: { min: -50, max: 9999, default: 3 } } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lab.constants.find((c) => c.id === 'M')!.value).toBe(500);
    expect(r.lab.constants.find((c) => c.id === 'px')!.value).toBe(7);
    expect(r.lab.variables[0]).toMatchObject({ min: 0.5, max: 40, default: 3 });
  });

  it('un modelo invalido rechaza la ficha con los errores del modelo', () => {
    const bad = { ...(example('consumidor').raw as Record<string, unknown>), outputs: [{ id: 'U', expr: '1/x' }], variables: [{ id: 'x', min: 0, max: 10 }], constants: [], derived: [], scene: null };
    const r = validateLabSpec(raw({ model: bad }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/no es un número razonable/);
    expect(validateLabSpec({ template: 'modelo' }).ok).toBe(false);
    expect(validateLabSpec(raw({ model: 'texto' })).ok).toBe(false);
  });

  it('las plantillas fijas siguen igual y una plantilla inventada sigue siendo error', () => {
    expect(validateLabSpec({ template: 'trayectoria' }).ok).toBe(true);
    expect(validateLabSpec({ template: 'maquina-del-tiempo' }).ok).toBe(false);
    expect(validateLabSpec({ template: 'trayectoria', model: example('consumidor').raw }).ok).toBe(true);
    const r = validateLabSpec({ template: 'trayectoria', model: example('consumidor').raw });
    if (r.ok) expect(r.spec.model).toBeUndefined();
  });

  it('modo controlado: solo la independiente se mueve; en modo libre, todas', () => {
    const pob = { template: 'modelo', model: example('poblacion').raw };
    const c = buildLab({ ...pob, mode: 'controlado' });
    const l = buildLab({ ...pob, mode: 'libre' });
    if (!c.ok || !l.ok) throw new Error('x');
    expect(c.lab.variables.map((v) => v.locked)).toEqual([false, true, true]);
    expect(l.lab.variables.map((v) => v.locked)).toEqual([false, false, false]);
  });

  it('preguntas por defecto cuando no hay, y templateOfSpec / resolveLab coherentes', () => {
    const r = buildLab(raw({ questions: [] }));
    if (!r.ok) throw new Error('x');
    expect(r.lab.questions.length).toBeGreaterThanOrEqual(2);
    expect(templateOfSpec(r.spec)?.id).toBe('modelo');
    expect(resolveLab(r.spec)?.model).toEqual(r.spec.model);
    expect(templateOfSpec({ template: 'trayectoria' })?.id).toBe('trayectoria');
  });

  it('templateFromModel: el modelo visto como plantilla', () => {
    const t = templateFromModel(valid('impuesto'));
    expect(t.id).toBe('modelo');
    expect(t.area).toBe('economia');
    expect(t.defaultIndependent).toBe('t');
    expect(t.outputs.map((o) => o.id)).toContain('recaudo');
  });

  it('lo que viaja al iframe es JSON puro (sobrevive postMessage) y cabe en la base', () => {
    const r = buildLab(raw());
    if (!r.ok) throw new Error('x');
    const msg = buildInitMessage(r.lab, null, false, {});
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
    expect(JSON.stringify(r.spec).length).toBeLessThan(20000);
    for (const e of MODEL_EXAMPLES) expect(JSON.stringify(validateLabSpec({ template: 'modelo', model: e.raw })).length).toBeGreaterThan(100);
  });

  it('los ids del modelo cumplen los topes del protocolo (claves de ensayo)', () => {
    for (const e of MODEL_EXAMPLES) {
      const m = valid(e.id);
      expect(m.variables.length).toBeLessThanOrEqual(12);
      expect(m.outputs.length).toBeLessThanOrEqual(12);
    }
  });
});

// ─────────────────────────── el laboratorio dentro del iframe ───────────────────────────
describe('runtime del laboratorio a la medida (public/labs/models/modelo.js)', () => {
  const Modelo = req('./public/labs/models/modelo.js');
  const labFor = (id: string) => {
    const r = buildLab({ template: 'modelo', model: example(id).raw });
    if (!r.ok) throw new Error(r.errors.join(' '));
    return r.lab;
  };

  it('prepare devuelve un modelo que calcula IGUAL que el servidor (mismo evaluador)', () => {
    for (const e of MODEL_EXAMPLES) {
      const lab = labFor(e.id);
      const inst = Modelo.prepare(lab);
      expect(inst, e.id).not.toBeNull();
      const v = Object.fromEntries(lab.variables.map((x) => [x.id, x.default]));
      const c = Object.fromEntries(lab.constants.map((x) => [x.id, x.value]));
      expect(inst.model(v, c)).toEqual(evaluateModel(lab.model!, v, c));
    }
  });

  it('sin modelo, o con formulas que no compilan, prepare da null (el runtime dice "no se pudo cargar")', () => {
    expect(Modelo.prepare({ template: 'modelo' })).toBeNull();
    const lab = labFor('consumidor');
    const broken = { ...lab, model: { ...lab.model!, outputs: [{ id: 'U', label: 'U', unit: '', decimals: 1, expr: 'x +' }] } };
    expect(Modelo.prepare(broken)).toBeNull();
  });

  it('describe da un texto para lectores de pantalla con las variables y los resultados', () => {
    const lab = labFor('consumidor');
    const inst = Modelo.prepare(lab);
    const v = { x: 6 };
    const c = Object.fromEntries(lab.constants.map((x) => [x.id, x.value]));
    const t = inst.describe(v, c, inst.model(v, c));
    expect(t).toContain('Cantidad del bien X = 6,0');
    expect(t).toContain('Utilidad');
  });

  it('sceneData: la restriccion presupuestal es una recta que une (0, M/py) con (M/px, 0) y la canasta esta sobre ella', () => {
    const lab = labFor('consumidor');
    const inst = Modelo.prepare(lab);
    expect(inst).not.toBeNull();
    const compiled = Expr.compileModel({ variables: lab.model!.variables, constants: lab.model!.constants, derived: lab.model!.derived, outputs: lab.model!.outputs, scene: lab.model!.scene });
    if (!compiled.ok) throw new Error('x');
    const c = Object.fromEntries(lab.constants.map((x) => [x.id, x.value]));
    const data = Modelo.sceneData(lab, compiled, { x: 6 }, c);
    const budget = data.curves[0].pts;
    expect(budget[0][0]).toBeCloseTo(0, 10);
    expect(budget[0][1]).toBeCloseTo(25, 10);
    expect(budget[budget.length - 1][0]).toBeCloseTo(20, 10);
    expect(budget[budget.length - 1][1]).toBeCloseTo(0, 10);
    // la curva de indiferencia pasa por la canasta actual
    const mark = data.marks[0];
    expect(mark.y).toBeCloseTo((100 - 5 * 6) / 4, 10);
    const near = data.curves[1].pts.reduce((best: number[], p: number[]) => (Math.abs(p[0] - mark.x) < Math.abs(best[0] - mark.x) ? p : best));
    expect(near[1]).toBeCloseTo(mark.y, 0);
  });

  it('sin escena declarada se dibuja la salida de la grafica contra la variable independiente', () => {
    const base = example('consumidor').raw as Record<string, unknown>;
    const r = buildLab({ template: 'modelo', model: { ...base, scene: null } });
    if (!r.ok) throw new Error(r.errors.join(' '));
    const lab = r.lab;
    const compiled = Expr.compileModel({ variables: lab.model!.variables, constants: lab.model!.constants, derived: lab.model!.derived, outputs: lab.model!.outputs, scene: lab.model!.scene });
    if (!compiled.ok) throw new Error('x');
    const c = Object.fromEntries(lab.constants.map((x) => [x.id, x.value]));
    const data = Modelo.sceneData(lab, compiled, { x: 6 }, c);
    expect(data.curves).toHaveLength(1);
    expect(data.curves[0].sweep).toBe('U');
    expect(data.curves[0].pts.length).toBeGreaterThan(50);
    expect(data.curves[0].pts.every((p: number[]) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true);
  });
});

// ─────────────────────────── archivos y seguridad ───────────────────────────
describe('archivos del laboratorio a la medida', () => {
  const html = read('public/labs/modelo.html');
  const BAD = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'new Function', 'Function(', 'document.write', 'localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'importScripts', 'WebSocket', 'document.cookie', 'setTimeout(', 'setInterval(', 'import('];

  it('modelo.html carga el runtime, el evaluador y el modelo generico, y se identifica como "modelo"', () => {
    expect(html).toContain('data-lab-template="modelo"');
    expect(html).toContain('<script src="runtime.js"></script>');
    expect(html).toContain('<script src="expr.js"></script>');
    expect(html).toContain('<script src="models/modelo.js"></script>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // ningun script en linea
    expect(html.indexOf('runtime.js')).toBeLessThan(html.indexOf('models/modelo.js'));
  });

  it('el evaluador y el modelo generico no evaluan texto, no usan la pagina, la red ni el almacenamiento', () => {
    for (const f of ['public/labs/expr.js', 'public/labs/models/modelo.js']) {
      const src = codeOnly(read(f));
      for (const bad of BAD) expect(src, `${f}: ${bad}`).not.toContain(bad);
      expect(src, f).not.toMatch(/\bdocument\b/);
      expect(src, f).not.toMatch(/\bwindow\.(parent|top|location|open)\b/);
    }
  });

  it('el runtime tiene el gancho prepare y sigue sin eval', () => {
    const rt = read('public/labs/runtime.js');
    expect(rt).toContain("typeof model.prepare === 'function'");
    expect(codeOnly(rt)).not.toContain('eval(');
  });

  it('los archivos nuevos se sirven sin sesion (el iframe aislado no manda cookies)', () => {
    expect(isPublicAsset('/labs/modelo.html')).toBe(true);
    expect(isPublicAsset('/labs/expr.js')).toBe(true);
    expect(isPublicAsset('/labs/models/modelo.js')).toBe(true);
  });

  it('la funcion if es la unica con evaluacion perezosa y el parser no usa recursion sin tope', () => {
    const src = read('public/labs/expr.js');
    expect(src).toContain('LIMITS.depth');
    expect(src).toContain('LIMITS.nodes');
    expect(src).toContain('LIMITS.chars');
  });
});

// ─────────────────────────── panel del profesor con modelos a la medida ───────────────────────────
import { rowToItem, type LabRow } from './labRows';
import { exampleSpec } from './modelExamples';
import { limitHint, normalizeDraft, withConstant, withVariable } from './labEditor';

describe('el panel del profesor con laboratorios a la medida', () => {
  const row = (spec: unknown, over: Partial<LabRow> = {}): LabRow => ({
    id: 'a1', classroom_id: 'c1', teacher_id: 't1', title: 'El consumidor', template: 'modelo', spec, source_material_id: null, status: 'draft',
    created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', published_at: null, ...over,
  });

  it('exampleSpec da una ficha valida con el modelo dentro (todas)', () => {
    for (const e of MODEL_EXAMPLES) {
      const s = exampleSpec(e);
      expect(s, e.id).not.toBeNull();
      expect(s!.template).toBe('modelo');
      expect(s!.model).toBeDefined();
      expect(s!.title.length).toBeLessThanOrEqual(120);
    }
  });

  it('una fila guardada a la medida se lee con su modelo, area y nombre (no como "plantilla retirada")', () => {
    const spec = exampleSpec(example('impuesto'))!;
    const it = rowToItem(row(JSON.parse(JSON.stringify(spec))));
    expect(it.spec?.model).toBeDefined();
    expect(it.lab?.model?.outputs.map((o) => o.id)).toContain('recaudo');
    expect(it.templateName).toBe('Modelo a la medida');
    expect(it.areaLabel).toBe('Economía');
  });

  it('si lo guardado se corrompe (formulas rotas), la fila no rompe la lista: queda ilegible', () => {
    const spec = JSON.parse(JSON.stringify(exampleSpec(example('impuesto'))!));
    spec.model.outputs[0].expr = '1/(t-t)';
    const it = rowToItem(row(spec));
    expect(it.spec).toBeNull();
    expect(it.lab).toBeNull();
  });

  it('una ficha a la medida sin modelo es ilegible, no un error', () => {
    expect(rowToItem(row({ template: 'modelo', title: 'x' })).spec).toBeNull();
  });

  it('el editor: pistas de limites y ajustes sobre un modelo', () => {
    const spec = exampleSpec(example('consumidor'))!;
    expect(limitHint(spec, 'x')).toBe('Límite de la plantilla: de 0,5 a 40 u');
    const n = normalizeDraft(withConstant(withVariable(spec, 'x', { max: 9999 }), 'M', 99999))!;
    expect(n.lab.variables[0].max).toBe(40);
    expect(n.lab.constants.find((c) => c.id === 'M')!.value).toBe(500);
    expect(n.warnings.join(' ')).toMatch(/fuera del rango permitido/);
  });
});
