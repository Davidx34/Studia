import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const h = vi.hoisted(() => ({ throwOn: null as string | null }));
vi.mock('./selfGrade', async (importOriginal) => {
  const real = await importOriginal<typeof import('./selfGrade')>();
  return {
    ...real,
    selfGrade: (row: any) => {
      if (h.throwOn && row?.q === h.throwOn) throw new Error('averia de la compuerta');
      return real.selfGrade(row);
    },
  };
});

import { gateEnabled, gateGenerated, logGateResult } from './runtimeGate';

const good = (q = 'Pregunta buena') => ({ type: 'multiple_choice', q, opts: ['A. uno', 'B. dos', 'C. tres'], ok: 1 });
const ambiguous = (q = 'Pregunta ambigua') => ({ type: 'multiple_choice', q, opts: ['A. igual', 'B. igual', 'C. otra'], ok: 0 });
const twoImpostors = () => ({ type: 'impostor_cognitivo', game_data: { statements: [{ id: 1, is_impostor: true }, { id: 2, is_impostor: true }, { id: 3, is_impostor: false }] } });
const goodGame = () => ({ type: 'impostor_cognitivo', game_data: { context: 'c', statements: [{ id: 1, is_impostor: true }, { id: 2, is_impostor: false }] } });

afterEach(() => {
  h.throwOn = null;
  vi.restoreAllMocks();
});

describe('gateGenerated', () => {
  it('conserva lo que se puede calificar y descarta lo que no, SIN reordenar y devolviendo los mismos objetos', () => {
    const a = good('a');
    const b = ambiguous('b');
    const c = goodGame();
    const d = twoImpostors();
    const e = good('e');
    const r = gateGenerated([a, b, c, d, e], true);
    expect(r.kept).toEqual([a, c, e]);
    expect(r.kept[0]).toBe(a);
    expect(r.kept[1]).toBe(c);
    expect(r.rejected.map((x) => x.type)).toEqual(['multiple_choice', 'impostor_cognitivo']);
    expect(r.rejected[0].failures.join()).toMatch(/dicen lo mismo/);
    expect(r.rejected[1].failures.join()).toMatch(/soluciones marcadas/);
  });
  it('una lista vacia o toda buena', () => {
    expect(gateGenerated([], true)).toEqual({ kept: [], rejected: [], warned: 0, errors: 0 });
    const all = [good('1'), good('2')];
    expect(gateGenerated(all, true).kept).toEqual(all);
  });
  it('un lote TODO imposible deja 0 conservadas', () => {
    const r = gateGenerated([ambiguous('1'), twoImpostors()], true);
    expect(r.kept).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });
  it('un tipo que el servidor no califica se conserva (no hay nada que simular)', () => {
    const odd = { type: 'tipo_futuro', q: 'x' };
    expect(gateGenerated([odd], true).kept).toEqual([odd]);
  });
  it('los AVISOS no descartan: una respuesta de un caracter se conserva y se cuenta', () => {
    const q = { type: 'fill_blank', q: 'El eje ___', answers: ['y'] };
    const r = gateGenerated([q, good()], true);
    expect(r.kept).toHaveLength(2);
    expect(r.warned).toBe(1);
    expect(r.rejected).toEqual([]);
  });
  it('con la compuerta APAGADA todo se conserva, tambien lo imposible', () => {
    const bad = ambiguous();
    const r = gateGenerated([bad, twoImpostors()], false);
    expect(r.kept).toHaveLength(2);
    expect(r.rejected).toEqual([]);
  });
  it('si la compuerta MISMA falla, el ejercicio se conserva y se cuenta el error (no deja a la clase sin lecciones)', () => {
    h.throwOn = 'se rompe';
    const broken = good('se rompe');
    const r = gateGenerated([broken, ambiguous('x'), good('ok')], true);
    expect(r.kept).toContain(broken);
    expect(r.kept).toHaveLength(2); // la rota y la buena; la ambigua sigue descartada
    expect(r.errors).toBe(1);
    expect(r.rejected).toHaveLength(1);
  });
  it('entradas raras no la rompen', () => {
    const r = gateGenerated([null as any, undefined as any, {} as any, { type: 5 } as any, good()], true);
    expect(r.kept).toContainEqual(good());
    expect(r.rejected.length + r.kept.length + r.errors).toBeGreaterThanOrEqual(5);
  });
  it('por defecto lee el interruptor del entorno', () => {
    const before = process.env.JEV_GATE;
    try {
      process.env.JEV_GATE = 'off';
      expect(gateGenerated([ambiguous()]).kept).toHaveLength(1);
      delete process.env.JEV_GATE;
      expect(gateGenerated([ambiguous()]).kept).toHaveLength(0);
    } finally {
      if (before === undefined) delete process.env.JEV_GATE;
      else process.env.JEV_GATE = before;
    }
  });
});

describe('gateEnabled', () => {
  it('solo JEV_GATE=off la apaga', () => {
    expect(gateEnabled({})).toBe(true);
    expect(gateEnabled({ JEV_GATE: 'on' })).toBe(true);
    expect(gateEnabled({ JEV_GATE: '' })).toBe(true);
    expect(gateEnabled({ JEV_GATE: 'OFF' })).toBe(true); // exacto, como GRADING_SHADOW
    expect(gateEnabled({ JEV_GATE: 'off' })).toBe(false);
  });
});

describe('logGateResult: registra el tipo y el motivo, nunca el contenido', () => {
  it('sin descartes no registra nada', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logGateResult('GENERATE', { moduleId: 'm1' }, gateGenerated([good()], true));
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
  it('con descartes registra etiqueta, modulo, cuantas y por que, SIN el enunciado', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = gateGenerated([ambiguous('ENUNCIADO SECRETO XYZ'), good('otra')], true);
    logGateResult('REGENERATE', { moduleId: 'm9' }, result);
    expect(warn).toHaveBeenCalledTimes(1);
    const [tag, payload] = warn.mock.calls[0] as [string, any];
    expect(tag).toBe('[JEV_REJECTED:REGENERATE]');
    expect(payload).toMatchObject({ moduleId: 'm9', descartadas: 1, conservadas: 1 });
    expect(payload.detalle[0].type).toBe('multiple_choice');
    expect(payload.detalle[0].motivo).toMatch(/dicen lo mismo/);
    expect(JSON.stringify(payload)).not.toContain('SECRETO');
  });
  it('una averia de la compuerta se registra como error', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.throwOn = 'se rompe';
    logGateResult('GENERATE', { moduleId: 'm1' }, gateGenerated([good('se rompe')], true));
    expect(err).toHaveBeenCalledWith('[JEV_GATE_ERROR:GENERATE]', { moduleId: 'm1', errors: 1 });
  });
});

describe('cableado: la compuerta va ANTES de guardar, en los dos caminos de generacion', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
  it('la ruta del estudiante filtra con la compuerta y solo guarda y sirve lo que paso', () => {
    const src = read('src/app/api/generate-questions/route.ts');
    expect(src).toContain("import { gateGenerated, logGateResult } from '@/lib/jev/runtimeGate';");
    expect(src).toContain('const gate = gateGenerated(structurallyValid);');
    expect(src).toContain('const validGenerated = gate.kept;');
    // y lo descartado se registra (sin esto nadie sabria cuantas preguntas imposibles genera la IA)
    expect(src).toContain("logGateResult('GENERATE', { moduleId }, gate);");
    expect(src.indexOf("logGateResult('GENERATE'")).toBeGreaterThan(src.indexOf('gateGenerated(structurallyValid)'));
    expect(src.indexOf('gateGenerated(structurallyValid)')).toBeLessThan(src.indexOf(".from('lesson_questions').insert(rows)"));
    // despues de la compuerta ya no se usa nada sin filtrar
    const after = src.slice(src.indexOf('const validGenerated = gate.kept;'));
    expect(after).not.toContain('structurallyValid');
    expect(after).not.toContain('onConfig');
  });
  it('regeneratePool filtra cada lote con la compuerta antes de armar las filas y de borrar el pool', () => {
    const src = read('src/lib/questions/regeneratePool.ts');
    expect(src).toContain('const gate = gateGenerated(structurallyValid);');
    expect(src).toContain('return gate.kept;');
    expect(src.indexOf('gateGenerated(structurallyValid)')).toBeLessThan(src.indexOf("No se genero ninguna pregunta valida"));
    expect(src.indexOf("No se genero ninguna pregunta valida")).toBeLessThan(src.indexOf(".delete().eq('module_id', moduleId)"));
  });
});
