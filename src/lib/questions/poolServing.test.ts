import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { servableQuestions, drawQuestions, shuffled } from './poolServing';

const mc = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'multiple_choice',
  q: `Pregunta ${id}`,
  opts: ['A. uno', 'B. dos', 'C. tres', 'D. cuatro'],
  ok: 0,
  exp: 'porque si',
  concept_tag: null,
  is_backup: false,
  review_status: 'approved',
  ...extra,
});

const ALL = new Set(['multiple_choice', 'true_false', 'fill_blank', 'match']);

describe('servableQuestions', () => {
  it('incluye activas Y de reserva (antes la reserva no se servia nunca)', () => {
    const rows = [mc('a'), mc('b', { is_backup: true })];
    expect(servableQuestions(rows, ALL).map((q) => q.id).sort()).toEqual(['a', 'b']);
  });

  it('REGRESION: jamas sirve una rechazada, ni siquiera si el modulo solo tiene reserva', () => {
    // Antes: sin activas se servia "todo el cache", incluidas las rechazadas.
    const rows = [mc('r1', { is_backup: true, review_status: 'rejected' }), mc('r2', { is_backup: true, review_status: 'rejected' })];
    expect(servableQuestions(rows, ALL)).toEqual([]);
  });

  it('descarta preguntas incompletas', () => {
    const rows = [mc('ok'), mc('rota', { opts: null })];
    expect(servableQuestions(rows, ALL).map((q) => q.id)).toEqual(['ok']);
  });

  it('descarta tipos que la configuracion actual ya no permite', () => {
    const rows = [mc('a'), { ...mc('b'), type: 'true_false', opts: null, ok: true }];
    expect(servableQuestions(rows, new Set(['multiple_choice'])).map((q) => q.id)).toEqual(['a']);
  });

  it('el shape sirve al cliente: id y concept_tag presentes', () => {
    const [q] = servableQuestions([mc('a', { concept_tag: 'oferta' })], ALL);
    expect(q).toMatchObject({ id: 'a', concept_tag: 'oferta', type: 'multiple_choice' });
  });
});

describe('drawQuestions', () => {
  const pool = Array.from({ length: 20 }, (_, i) => i);

  it('devuelve exactamente count elementos distintos', () => {
    const d = drawQuestions(pool, 5);
    expect(d).toHaveLength(5);
    expect(new Set(d).size).toBe(5);
  });

  it('con menos preguntas que count devuelve las que hay', () => {
    expect(drawQuestions([1, 2], 5)).toHaveLength(2);
  });

  it('no modifica el pool original', () => {
    const copy = [...pool];
    drawQuestions(pool, 5);
    expect(pool).toEqual(copy);
  });

  it('el sorteo depende del generador (es realmente aleatorio, no un orden fijo)', () => {
    const seq = (seed: number) => {
      let s = seed;
      return () => ((s = (s * 16807) % 2147483647) / 2147483647);
    };
    expect(shuffled(pool, seq(1))).not.toEqual(shuffled(pool, seq(2)));
  });

  it('con muchas extracciones toda pregunta del pool, activa o de reserva, llega a salir', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) drawQuestions(pool, 5).forEach((n) => seen.add(n));
    expect(seen.size).toBe(pool.length);
  });
});

const read = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g'), String.fromCharCode(10));

describe('cableado', () => {
  it('la ruta del estudiante sirve con servableQuestions y drawQuestions', () => {
    const route = read('src/app/api/generate-questions/route.ts');
    expect(route).toContain('servableQuestions(');
    expect(route).toContain('drawQuestions(');
    // El filtro viejo que ignoraba la reserva no debe volver.
    expect(route).not.toMatch(/filter\(\(row: any\) => !row\.is_backup\)/);
  });
});
