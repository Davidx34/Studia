import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { acquireGenerationLock, releaseGenerationLock, withGenerationLock, LOCK_TTL_MS } from './generationLock';

// Supabase simulado: registra cada llamada rpc y responde con lo que se le indique.
function fakeSupabase(acquire: { data?: any; error?: any } = { data: 'acquired', error: null }, release: { error?: any } = { error: null }) {
  const rpcs: { name: string; args: any }[] = [];
  const supabase = {
    rpc: vi.fn(async (name: string, args: any) => {
      rpcs.push({ name, args });
      if (name === 'acquire_generation_lock') return { data: acquire.data ?? null, error: acquire.error ?? null };
      return { data: null, error: release.error ?? null };
    }),
    // Si el codigo volviera a escribir la tabla directamente, esto revienta el test.
    from: () => {
      throw new Error('el bloqueo NO debe escribir content_modules directamente (RLS)');
    },
  };
  return { supabase, rpcs };
}

const releases = (rpcs: { name: string }[]) => rpcs.filter((c) => c.name === 'release_generation_lock');

// Historia: el bloqueo estuvo roto DOS veces en produccion, con el mismo sintoma.
//  1) La columna is_generating no existia (migracion 041 sin aplicar): PGRST204.
//  2) Con la columna, el UPDATE directo lo hacia la sesion del ESTUDIANTE, que solo
//     puede LEER content_modules: con RLS eso afecta 0 filas SIN error, y "0 filas"
//     se leia como "ocupado". Nadie podia tomar el bloqueo: 202 sin fin.
describe('acquireGenerationLock', () => {
  it.each(['acquired', 'busy', 'forbidden'] as const)('traduce la respuesta "%s" de la funcion SQL', async (respuesta) => {
    const { supabase } = fakeSupabase({ data: respuesta });
    expect(await acquireGenerationLock(supabase, 'm1')).toBe(respuesta);
  });

  it('llama a la funcion SQL con el modulo y la caducidad, no a la tabla', async () => {
    const { supabase, rpcs } = fakeSupabase();
    await acquireGenerationLock(supabase, 'm1');
    expect(rpcs).toEqual([{ name: 'acquire_generation_lock', args: { p_module_id: 'm1', p_ttl_seconds: LOCK_TTL_MS / 1000 } }]);
  });

  it('un ERROR de la base es "unavailable", NO "busy": el bloqueo roto no es una generacion en curso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = fakeSupabase({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    expect(await acquireGenerationLock(supabase, 'm1')).toBe('unavailable');
  });

  it('una respuesta que la funcion nunca da tambien es "unavailable", no "ocupado"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const data of [null, undefined, '', 'algo raro', 42, true]) {
      const { supabase } = fakeSupabase({ data });
      expect(await acquireGenerationLock(supabase, 'm1')).toBe('unavailable');
    }
  });

  it('el limite es de unos minutos: mas que una generacion, menos que "para siempre"', () => {
    expect(LOCK_TTL_MS).toBeGreaterThanOrEqual(120_000); // una generacion medida llega a ~110 s
    expect(LOCK_TTL_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe('releaseGenerationLock', () => {
  afterEach(() => vi.restoreAllMocks());

  it('llama a la funcion SQL de liberar', async () => {
    const { supabase, rpcs } = fakeSupabase();
    await releaseGenerationLock(supabase, 'm1');
    expect(rpcs).toEqual([{ name: 'release_generation_lock', args: { p_module_id: 'm1' } }]);
  });

  it('un fallo al liberar se registra pero no lanza: no tira una generacion ya terminada', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = fakeSupabase({ data: 'acquired' }, { error: { code: 'X', message: 'boom' } });
    await expect(releaseGenerationLock(supabase, 'm1')).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });
});

describe('withGenerationLock', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('tomado: ejecuta la funcion y libera al terminar', async () => {
    const { supabase, rpcs } = fakeSupabase({ data: 'acquired' });
    const fn = vi.fn(async () => 'listo');
    const r = await withGenerationLock(supabase, 'm1', fn);
    expect(r).toEqual({ status: 'ok', value: 'listo' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(releases(rpcs)).toHaveLength(1);
  });

  it('REGRESION: si esta ocupado NO ejecuta la funcion y NO libera el bloqueo de otro', async () => {
    // Antes, el `finally` de la ruta liberaba SIEMPRE: una peticion que recibia
    // "ocupado" liberaba el bloqueo de la que si estaba generando.
    const { supabase, rpcs } = fakeSupabase({ data: 'busy' });
    const fn = vi.fn(async () => 'no deberia correr');
    const r = await withGenerationLock(supabase, 'm1', fn);
    expect(r).toEqual({ status: 'busy' });
    expect(fn).not.toHaveBeenCalled();
    expect(releases(rpcs)).toHaveLength(0);
  });

  it('prohibido (no es de este modulo): no genera, no libera', async () => {
    const { supabase, rpcs } = fakeSupabase({ data: 'forbidden' });
    const fn = vi.fn(async () => 'no deberia correr');
    const r = await withGenerationLock(supabase, 'm1', fn);
    expect(r).toEqual({ status: 'forbidden' });
    expect(fn).not.toHaveBeenCalled();
    expect(releases(rpcs)).toHaveLength(0);
  });

  it('bloqueo NO disponible (funcion ausente): genera igual y no intenta liberar', async () => {
    // Mejor generar sin bloqueo que no generar nunca.
    const { supabase, rpcs } = fakeSupabase({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    const fn = vi.fn(async () => 'generado');
    const r = await withGenerationLock(supabase, 'm1', fn);
    expect(r).toEqual({ status: 'ok', value: 'generado' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(releases(rpcs)).toHaveLength(0);
  });

  it('si la funcion lanza, el bloqueo se libera igual y el error se propaga', async () => {
    const { supabase, rpcs } = fakeSupabase({ data: 'acquired' });
    await expect(withGenerationLock(supabase, 'm1', async () => { throw new Error('Cohere fallo'); })).rejects.toThrow('Cohere fallo');
    expect(releases(rpcs)).toHaveLength(1);
  });

  it('sin moduleId ejecuta la funcion sin tocar la base', async () => {
    const { supabase, rpcs } = fakeSupabase();
    const r = await withGenerationLock(supabase, undefined, async () => 'x');
    expect(r).toEqual({ status: 'ok', value: 'x' });
    expect(rpcs).toEqual([]);
  });
});

const read = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g'), String.fromCharCode(10));

// Guardas de la CAUSA RAIZ, que ningun test con Supabase simulado puede atrapar:
// el fallo dependia del RLS de la base real.
describe('guardas contra la causa raiz', () => {
  const lockSrc = read('src/lib/questions/generationLock.ts');
  const sql = read('supabase/migrations/047_generation_lock_functions.sql');

  it("el bloqueo no escribe content_modules directamente: un estudiante solo puede leerla", () => {
    // Codigo sin comentarios, para no confundir la historia con el uso.
    const code = lockSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\.from\(\s*['"]content_modules['"]\s*\)/);
    expect(code).not.toMatch(/\.update\(/);
  });

  it('las funciones SQL comprueban que quien llama es el profesor del modulo o un estudiante inscrito', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('m.teacher_id = auth.uid()');
    expect(sql).toContain('class_enrollments');
    expect(sql).toContain("RETURN 'forbidden'");
  });

  it('la caducidad esta acotada en la base: el llamador no puede robar el bloqueo con un ttl de 0', () => {
    expect(sql).toMatch(/LEAST\(GREATEST\(/);
  });

  it('no se puede ejecutar sin sesion', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.acquire_generation_lock[^;]*FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.acquire_generation_lock[^;]*TO authenticated/);
  });

  it('tomar el bloqueo es UN solo UPDATE condicional (atomico)', () => {
    expect(sql.match(/UPDATE public\.content_modules/g)!.length).toBe(2); // uno al tomar, otro al liberar
  });
});

describe('cableado en la ruta y en la pagina del estudiante', () => {
  const route = read('src/app/api/generate-questions/route.ts');
  const page = read('src/app/(student)/lesson/[id]/page.tsx');

  it('la ruta usa withGenerationLock y ya no libera en un finally incondicional', () => {
    expect(route).toContain('withGenerationLock(');
    expect(route).not.toContain('releaseGenerationLock');
    expect(route).not.toMatch(/\} finally \{/);
  });

  it('la ruta declara maxDuration acorde a lo medido (37-67 s, ~110 s con reintentos)', () => {
    const n = Number(route.match(/export const maxDuration = (\d+)/)![1]);
    expect(n).toBeGreaterThanOrEqual(120);
  });

  it('ocupado responde 202 y sin acceso responde 403', () => {
    expect(route).toMatch(/outcome\.status === 'busy'[\s\S]*status: 202/);
    expect(route).toMatch(/outcome\.status === 'forbidden'[\s\S]*status: 403/);
  });

  it('la pagina del estudiante espera y reintenta ante un 202 en vez de mostrar un fallo', () => {
    expect(page).toContain('res.status === 202');
    expect(page).toContain('BUSY_MAX_ATTEMPTS');
    expect(page).toContain('res.ok && res.status !== 202');
  });
});
