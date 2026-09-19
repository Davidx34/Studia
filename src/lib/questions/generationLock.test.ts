import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { acquireGenerationLock, releaseGenerationLock, withGenerationLock, LOCK_TTL_MS } from './generationLock';

// Supabase simulado: registra cada llamada y responde a .select() con `result`.
// El UPDATE del bloqueo termina en .select('id'); el de liberar se espera sin select.
function fakeSupabase(result: { data?: any[] | null; error?: any } = { data: [{ id: 'm1' }], error: null }) {
  const calls: { op: string; arg?: any }[] = [];
  const chain: any = {
    update: (v: any) => (calls.push({ op: 'update', arg: v }), chain),
    eq: (c: string, v: any) => (calls.push({ op: 'eq', arg: [c, v] }), chain),
    or: (s: string) => (calls.push({ op: 'or', arg: s }), chain),
    select: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
  };
  return { supabase: { from: (t: string) => (calls.push({ op: 'from', arg: t }), chain) }, calls };
}

const updates = (calls: { op: string; arg?: any }[]) => calls.filter((c) => c.op === 'update').map((c) => c.arg);

// Historia: la migracion 041 (columna is_generating) nunca se aplico en produccion.
// acquireGenerationLock fallaba SIEMPRE, devolvia false, y la ruta lo leia como
// "ya hay otra generacion en curso": 202 sin preguntas. Ningun modulo con el cache
// vacio se podia generar al abrirlo.
describe('acquireGenerationLock', () => {
  const NOW = Date.parse('2026-09-19T20:00:00.000Z');

  it('devuelve "acquired" cuando el UPDATE afecto una fila', async () => {
    const { supabase } = fakeSupabase({ data: [{ id: 'm1' }] });
    expect(await acquireGenerationLock(supabase, 'm1', NOW)).toBe('acquired');
  });

  it('devuelve "busy" cuando nadie se llevo la fila: ya hay una generacion en curso', async () => {
    const { supabase } = fakeSupabase({ data: [] });
    expect(await acquireGenerationLock(supabase, 'm1', NOW)).toBe('busy');
  });

  it('un ERROR de la base es "unavailable", NO "busy": el bloqueo roto no es una generacion en curso', async () => {
    const { supabase } = fakeSupabase({ data: null, error: { code: 'PGRST204', message: "Could not find the 'is_generating' column" } });
    expect(await acquireGenerationLock(supabase, 'm1', NOW)).toBe('unavailable');
  });

  it('toma el bloqueo marcando la hora, para que pueda caducar', async () => {
    const { supabase, calls } = fakeSupabase();
    await acquireGenerationLock(supabase, 'm1', NOW);
    expect(updates(calls)[0]).toEqual({ is_generating: true, generation_started_at: '2026-09-19T20:00:00.000Z' });
  });

  it('un bloqueo abandonado caduca: se puede tomar si esta libre, sin hora o mas viejo que el limite', async () => {
    const { supabase, calls } = fakeSupabase();
    await acquireGenerationLock(supabase, 'm1', NOW);
    const or = calls.find((c) => c.op === 'or')!.arg as string;
    const corte = new Date(NOW - LOCK_TTL_MS).toISOString();
    expect(or).toContain('is_generating.eq.false');
    expect(or).toContain('generation_started_at.is.null');
    expect(or).toContain(`generation_started_at.lt.${corte}`);
  });

  it('el limite es de unos minutos: mas que una generacion, menos que "para siempre"', () => {
    expect(LOCK_TTL_MS).toBeGreaterThanOrEqual(60_000);
    expect(LOCK_TTL_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe('releaseGenerationLock', () => {
  it('libera y limpia la hora', async () => {
    const { supabase, calls } = fakeSupabase();
    await releaseGenerationLock(supabase, 'm1');
    expect(updates(calls)).toEqual([{ is_generating: false, generation_started_at: null }]);
  });
});

describe('withGenerationLock', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('tomado: ejecuta la funcion y libera al terminar', async () => {
    const { supabase, calls } = fakeSupabase({ data: [{ id: 'm1' }] });
    const fn = vi.fn(async () => 'listo');
    const r = await withGenerationLock(supabase, 'm1', fn);
    expect(r).toEqual({ busy: false, value: 'listo' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(updates(calls).at(-1)).toEqual({ is_generating: false, generation_started_at: null });
  });

  it('REGRESION: si esta ocupado NO ejecuta la funcion y NO libera el bloqueo de otro', async () => {
    // Antes, el `finally` de la ruta liberaba SIEMPRE. Una peticion que recibia
    // "ocupado" liberaba el bloqueo de la que si estaba generando, y una tercera
    // podia entrar: se duplicaban las generaciones que el bloqueo debia evitar.
    const { supabase, calls } = fakeSupabase({ data: [] });
    const fn = vi.fn(async () => 'no deberia correr');
    const r = await withGenerationLock(supabase, 'm1', fn);
    expect(r).toEqual({ busy: true });
    expect(fn).not.toHaveBeenCalled();
    expect(updates(calls).some((u) => u.is_generating === false)).toBe(false);
  });

  it('bloqueo NO disponible (columna ausente): genera igual y no intenta liberar', async () => {
    // Mejor generar sin bloqueo que no generar nunca.
    const { supabase, calls } = fakeSupabase({ data: null, error: { code: 'PGRST204', message: 'column missing' } });
    const fn = vi.fn(async () => 'generado');
    const r = await withGenerationLock(supabase, 'm1', fn);
    expect(r).toEqual({ busy: false, value: 'generado' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(updates(calls).some((u) => u.is_generating === false)).toBe(false);
  });

  it('si la funcion lanza, el bloqueo se libera igual y el error se propaga', async () => {
    const { supabase, calls } = fakeSupabase({ data: [{ id: 'm1' }] });
    await expect(withGenerationLock(supabase, 'm1', async () => { throw new Error('Cohere fallo'); })).rejects.toThrow('Cohere fallo');
    expect(updates(calls).at(-1)).toEqual({ is_generating: false, generation_started_at: null });
  });

  it('sin moduleId ejecuta la funcion sin tocar la base', async () => {
    const { supabase, calls } = fakeSupabase();
    const r = await withGenerationLock(supabase, undefined, async () => 'x');
    expect(r).toEqual({ busy: false, value: 'x' });
    expect(calls).toEqual([]);
  });
});

describe('cableado en la ruta y en la pagina del estudiante', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g'), String.fromCharCode(10));
  const route = read('src/app/api/generate-questions/route.ts');
  const page = read('src/app/(student)/lesson/[id]/page.tsx');

  it('la ruta usa withGenerationLock y ya no libera en un finally incondicional', () => {
    expect(route).toContain('withGenerationLock(');
    expect(route).not.toContain('releaseGenerationLock');
    expect(route).not.toMatch(/\} finally \{/);
  });

  it('la ruta declara maxDuration: una generacion con Cohere no cabe en el limite por defecto', () => {
    expect(route).toMatch(/export const maxDuration = \d+/);
    const n = Number(route.match(/export const maxDuration = (\d+)/)![1]);
    // Medido: 37-67 s por generacion (y ~110 s con 3 reintentos internos de Cohere).
    expect(n).toBeGreaterThanOrEqual(120);
  });

  it('un bloqueo ocupado responde 202', () => {
    expect(route).toMatch(/outcome\.busy[\s\S]*status: 202/);
  });

  it('la pagina del estudiante espera y reintenta ante un 202 en vez de mostrar un fallo', () => {
    expect(page).toContain('res.status === 202');
    expect(page).toContain('BUSY_MAX_ATTEMPTS');
    expect(page).toContain('res.ok && res.status !== 202');
  });
});
