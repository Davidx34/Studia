import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DANGEROUS_KEYS, JSONB_BUDGETS, JSONB_MAX_DEPTH, guardJsonb, utf8Length, type JsonbBudget } from './jsonbGuard';

const OBJ = (limit: number): JsonbBudget => ({ limit, root: 'object' });
const must = (r: ReturnType<typeof guardJsonb>) => {
  if (!r.ok) throw new Error('se esperaba ok: ' + r.reason);
  return r;
};
// Un documento con EXACTAMENTE `levels` niveles de objetos anidados (la profundidad cuenta contenedores, no las hojas).
const nested = (levels: number): unknown => {
  let v: unknown = { a: 1 };
  for (let i = 1; i < levels; i++) v = { a: v };
  return v;
};

describe('presupuestos = CHECK de las migraciones (no se desvian)', () => {
  const sql = (f: string) => fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', f), 'utf8');
  const check = (file: string, column: string) => {
    const s = sql(file);
    const type = new RegExp(`jsonb_typeof\\(${column}\\)\\s*=\\s*'(object|array)'`).exec(s)?.[1];
    const size = new RegExp(`pg_column_size\\(${column}\\)\\s*<\\s*(\\d+)`).exec(s)?.[1];
    return { type, size: Number(size) };
  };
  it.each([
    ['labSpec', '078_labs.sql', 'spec'],
    ['classMemoryGraph', '079_class_memory.sql', 'graph'],
    ['classMemoryStats', '079_class_memory.sql', 'stats'],
    ['materialExtraction', '079_class_memory.sql', 'extraction'],
    ['labTrials', '082_lab_attempts.sql', 'trials'],
    ['labAnswers', '082_lab_attempts.sql', 'answers'],
    ['courseBlueprint', '085_course_blueprints.sql', 'doc'],
  ] as const)('%s coincide con %s (%s)', (name, file, col) => {
    const c = check(file, col);
    expect(JSONB_BUDGETS[name].limit).toBe(c.size);
    expect(JSONB_BUDGETS[name].root).toBe(c.type);
  });
  it('materialStats coincide con el tope de stats de class_memory_material (4000, objeto)', () => {
    expect(JSONB_BUDGETS.materialStats).toEqual({ limit: 4000, root: 'object' });
    const s = sql('079_class_memory.sql');
    expect(s.match(/pg_column_size\(stats\) < 4000/g)).toHaveLength(2);
  });
});

describe('guardJsonb: lo que limpia', () => {
  it('devuelve una COPIA limpia y no toca el original', () => {
    const original = { a: 'x\u0000y', n: [1, 2] };
    const r = must(guardJsonb(original, 'labSpec'));
    expect(r.value).toEqual({ a: 'xy', n: [1, 2] });
    expect(r.value).not.toBe(original);
    expect(original.a).toBe('x\u0000y');
  });
  it('quita el caracter NUL de valores y de claves, y lo cuenta', () => {
    const r = must(guardJsonb({ 'cl\u0000ave': 'a\u0000b\u0000', lista: ['\u0000'] }, 'labSpec'));
    expect(r.value).toEqual({ clave: 'ab', lista: [''] });
    expect(r.report.strippedNul).toBe(4);
  });
  it('reemplaza sustitutos Unicode sueltos y conserva los pares validos (emojis)', () => {
    const r = must(guardJsonb({ a: 'ok\uD800fin', b: 'x\uDC00y', c: '😀 ñ', d: '😀' }, 'labSpec'));
    const v = r.value as Record<string, string>;
    expect(v.a).toBe('ok�fin');
    expect(v.b).toBe('x�y');
    expect(v.c).toBe('😀 ñ');
    expect(v.d).toBe('😀');
    expect(r.report.fixedSurrogates).toBe(2);
  });
  it('NaN e Infinity pasan a null (no son JSON) y se cuentan; los numeros normales no cambian', () => {
    const r = must(guardJsonb({ a: NaN, b: Infinity, c: -Infinity, d: 0, e: -1.5, f: 1e21 }, 'labSpec'));
    expect(r.value).toEqual({ a: null, b: null, c: null, d: 0, e: -1.5, f: 1e21 });
    expect(r.report.nonFinite).toBe(3);
  });
  it('undefined: se omite la clave en un objeto y pasa a null en un arreglo (como JSON)', () => {
    const r = must(guardJsonb({ a: undefined, b: [undefined, 1] }, 'labSpec'));
    expect(r.value).toEqual({ b: [null, 1] });
    expect(Object.keys(r.value as object)).toEqual(['b']);
  });
  it('un Date se guarda como su texto ISO', () => {
    const r = must(guardJsonb({ d: new Date('2026-10-31T12:00:00Z') }, 'labSpec'));
    expect((r.value as { d: string }).d).toBe('2026-10-31T12:00:00.000Z');
  });
  it('un valor "toJSON" que no es funcion no se ejecuta ni estorba', () => {
    const r = must(guardJsonb({ toJSON: 'texto', x: 1 }, 'labSpec'));
    expect(r.value).toEqual({ toJSON: 'texto', x: 1 });
  });
});

describe('guardJsonb: claves peligrosas', () => {
  it('quita __proto__, constructor y prototype en cualquier nivel, y cuenta cuantas', () => {
    const doc = JSON.parse('{"a":1,"__proto__":{"polluted":true},"n":{"constructor":{"x":1},"b":2,"l":[{"prototype":3,"c":4}]}}');
    const r = must(guardJsonb(doc, 'labSpec'));
    expect(r.value).toEqual({ a: 1, n: { b: 2, l: [{ c: 4 }] } });
    expect(r.report.removedKeys).toBe(3);
  });
  it('no contamina Object.prototype ni deja claves propias peligrosas', () => {
    const doc = JSON.parse('{"__proto__":{"polluted":true},"x":{"__proto__":{"otro":1}}}');
    const r = must(guardJsonb(doc, 'labSpec'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).otro).toBeUndefined();
    for (const k of DANGEROUS_KEYS) expect(Object.prototype.hasOwnProperty.call(r.value, k)).toBe(false);
    expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
  });
  it('la lista de claves peligrosas es exactamente la acordada', () => {
    expect([...DANGEROUS_KEYS].sort()).toEqual(['__proto__', 'constructor', 'prototype']);
  });
  it('una clave que se vuelve peligrosa al limpiar el NUL tampoco pasa por la puerta de atras (queda como clave normal)', () => {
    // "proto\u0000type" -> "prototype" DESPUES de limpiar: la comprobacion se hace sobre la clave original, asi que se conserva como clave inofensiva
    const r = must(guardJsonb(JSON.parse('{"proto\\u0000type":1}'), 'labSpec'));
    expect(Object.keys(r.value as object)).toEqual(['prototype']);
    expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).prototype).toBeUndefined();
  });
});

describe('guardJsonb: lo que rechaza', () => {
  it.each([
    ['una funcion', { f: () => 1 }],
    ['un simbolo', { s: Symbol('x') }],
    ['un bigint', { b: BigInt(5) }],
  ])('%s no es JSON: unsupported', (_n, doc) => {
    const r = guardJsonb(doc, 'labSpec');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('unsupported');
  });
  it('un ciclo se rechaza; una referencia compartida (rombo) NO es un ciclo', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(!guardJsonb(a, 'labSpec').ok && (guardJsonb(a, 'labSpec') as { reason: string }).reason).toBe('cycle');
    const shared = { v: 1 };
    const r = must(guardJsonb({ p: shared, q: shared, l: [shared, shared] }, 'labSpec'));
    expect(r.value).toEqual({ p: { v: 1 }, q: { v: 1 }, l: [{ v: 1 }, { v: 1 }] });
  });
  it('un ciclo dentro de un arreglo tambien', () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    const r = guardJsonb(arr, 'labTrials');
    expect(!r.ok && r.reason).toBe('cycle');
  });
  it('la profundidad maxima pasa y una mas se rechaza', () => {
    expect(guardJsonb(nested(JSONB_MAX_DEPTH), OBJ(1e6)).ok).toBe(true);
    const r = guardJsonb(nested(JSONB_MAX_DEPTH + 1), OBJ(1e6));
    expect(!r.ok && r.reason).toBe('depth');
  });
  it('un anidamiento enorme no desborda la pila', () => {
    const r = guardJsonb(nested(100_000), OBJ(1e9));
    expect(r.ok).toBe(false);
  });
  it('el tope de nodos se respeta', () => {
    const doc = { l: Array.from({ length: 50 }, (_, i) => i) };
    // 1 objeto + 1 arreglo + 50 numeros = 52 nodos
    expect(guardJsonb(doc, OBJ(1e6), { maxNodes: 52 }).ok).toBe(true);
    const r = guardJsonb(doc, OBJ(1e6), { maxNodes: 51 });
    expect(!r.ok && r.reason).toBe('nodes');
  });
  it('el tope de profundidad configurable se respeta', () => {
    expect(guardJsonb(nested(3), OBJ(1e6), { maxDepth: 3 }).ok).toBe(true);
    const r = guardJsonb(nested(4), OBJ(1e6), { maxDepth: 3 });
    expect(!r.ok && r.reason).toBe('depth');
  });
});

describe('guardJsonb: raiz y tamaño', () => {
  it('una columna de objeto rechaza arreglos, null, texto y numeros', () => {
    for (const v of [[], [1], null, 'texto', 5, undefined, true]) {
      const r = guardJsonb(v, 'labSpec');
      expect(r.ok, String(v)).toBe(false);
      expect(!r.ok && r.reason).toBe('notObject');
    }
  });
  it('una columna de arreglo rechaza objetos y escalares', () => {
    for (const v of [{}, { a: 1 }, null, 'x', 3]) {
      const r = guardJsonb(v, 'labTrials');
      expect(!r.ok && r.reason, String(v)).toBe('notArray');
    }
    expect(guardJsonb([], 'labTrials').ok).toBe(true);
  });
  it('el tamaño debe ser ESTRICTAMENTE menor que el limite (igual al limite se rechaza)', () => {
    const doc = (n: number) => ({ a: 'x'.repeat(n) }); // {"a":"...."} = 8 + n bytes
    expect(utf8Length(JSON.stringify(doc(91)))).toBe(99);
    const ok = must(guardJsonb(doc(91), OBJ(100)));
    expect(ok.bytes).toBe(99);
    const bad = guardJsonb(doc(92), OBJ(100));
    expect(!bad.ok && bad.reason).toBe('size');
    expect(!bad.ok && bad.bytes).toBe(100);
  });
  it('mide BYTES UTF-8, no caracteres', () => {
    // {"a":"ññ…"} = 8 + 2n bytes
    expect(guardJsonb({ a: 'ñ'.repeat(45) }, OBJ(100)).ok).toBe(true); // 98
    expect(guardJsonb({ a: 'ñ'.repeat(46) }, OBJ(100)).ok).toBe(false); // 100
    expect(guardJsonb({ a: '😀'.repeat(23) }, OBJ(100)).ok).toBe(false); // 8 + 92 = 100
  });
  it('mide el documento YA limpio (el NUL quitado no cuenta)', () => {
    const doc = { a: 'x'.repeat(91) + '\u0000'.repeat(50) };
    const r = must(guardJsonb(doc, OBJ(100)));
    expect(r.bytes).toBe(99);
  });
  it('un presupuesto con nombre usa su limite real', () => {
    const big = { a: 'x'.repeat(JSONB_BUDGETS.labSpec.limit) };
    const r = guardJsonb(big, 'labSpec');
    expect(!r.ok && r.reason).toBe('size');
    expect(guardJsonb({ a: 'x'.repeat(1000) }, 'labSpec').ok).toBe(true);
  });
  it('el mensaje de tamaño dice cuanto pesa y cual es el maximo', () => {
    const r = guardJsonb({ a: 'x'.repeat(200) }, OBJ(100));
    expect(!r.ok && r.message).toMatch(/208 bytes.*99/);
  });
});

describe('guardJsonb: robustez', () => {
  it('nunca lanza con entradas raras y su salida siempre es JSON que sobrevive a un viaje de ida y vuelta', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const leaf = () => [0, -1, 1.5, NaN, Infinity, 'a', '\u0000', '\uD800', 'ñ😀', true, false, null, undefined][Math.floor(rnd() * 13)];
    const make = (d: number): unknown => {
      if (d === 0 || rnd() < 0.3) return leaf();
      if (rnd() < 0.5) return Array.from({ length: Math.floor(rnd() * 4) }, () => make(d - 1));
      const o: Record<string, unknown> = {};
      for (let i = 0; i < Math.floor(rnd() * 4); i++) o[['a', 'b', '__proto__x', 'constructor', 'k\u0000'][Math.floor(rnd() * 5)]] = make(d - 1);
      return o;
    };
    for (let i = 0; i < 300; i++) {
      const doc = { root: make(4) };
      const r = guardJsonb(doc, OBJ(1e6));
      expect(r.ok).toBe(true);
      if (r.ok) expect(JSON.parse(JSON.stringify(r.value))).toEqual(r.value);
    }
  });
  it('es idempotente: limpiar lo ya limpio no cambia nada', () => {
    const first = must(guardJsonb({ a: 'x\u0000', b: NaN, c: { d: [1, undefined] } }, 'labSpec'));
    const second = must(guardJsonb(first.value, 'labSpec'));
    expect(second.value).toEqual(first.value);
    expect(second.report).toEqual({ removedKeys: 0, strippedNul: 0, fixedSurrogates: 0, nonFinite: 0 });
  });
});

describe('cableado: los puntos de escritura pasan por la guardia', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
  it('el editor de laboratorios limpia la ficha ANTES de marcar "guardando" y escribe la copia limpia', () => {
    const src = read('src/app/(teacher)/teacher/classrooms/[id]/lab/LabEditor.tsx');
    expect(src).toContain("guardJsonb(fields.spec, 'labSpec')");
    expect(src).toMatch(/if \(!guard\.ok\) \{\s*setError\([^)]*\);\s*return;\s*\}/);
    expect(src).toContain('spec: guard.value');
    expect(src.indexOf("guardJsonb(fields.spec, 'labSpec')")).toBeLessThan(src.indexOf("setBusy(status === 'published'"));
  });
  it('la guardia solo importa codigo puro (se usa tambien en el navegador)', () => {
    const src = read('src/lib/db/jsonbGuard.ts');
    expect(src).not.toMatch(/^import /m);
  });
});
