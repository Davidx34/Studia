import { describe, expect, it, vi } from 'vitest';
import { checkLegacyAccess, legacyGate, prerequisiteIds } from './legacyGate';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('legacyGate (puro)', () => {
  it('sin prerrequisitos o todos dominados: abre', () => {
    expect(legacyGate([], new Set())).toEqual({ allowed: true });
    expect(legacyGate([id(1), id(2)], new Set([id(1), id(2)]))).toEqual({ allowed: true });
  });
  it('falta uno: niega y nombra solo el que falta', () => {
    const g = legacyGate([id(1), id(2)], new Set([id(1)]), new Map([[id(1), 'Uno'], [id(2), 'Dos']]));
    expect(g).toEqual({ allowed: false, message: 'Todavía no puedes abrir esta lección. Primero domina «Dos» al 100 %.' });
    expect(legacyGate([id(1)], new Set()).allowed).toBe(false);
    expect((legacyGate([id(1), id(2)], new Set()) as any).message).toContain('los módulos anteriores');
  });
  it('prerequisiteIds: solo uuids, sin repetir; tolera basura', () => {
    expect(prerequisiteIds([id(1), id(1), 'x', 3, null])).toEqual([id(1)]);
    expect(prerequisiteIds(null)).toEqual([]);
    expect(prerequisiteIds('a')).toEqual([]);
  });
});

// Clientes falsos: db (content_modules) y admin (lesson_attempts, student_progress).
const mkDb = (prereqs: unknown, err: unknown = null) => ({
  from: () => ({
    select: (cols: string) => ({
      eq: () => ({ maybeSingle: async () => ({ data: { prerequisites: prereqs }, error: err }) }),
      in: async () => ({ data: cols.includes('title') ? [{ id: id(1), title: 'Uno' }] : [], error: null }),
    }),
  }),
});
const mkAdmin = (attempts: unknown[], progress: unknown[], err: unknown = null) => ({
  from: (t: string) => ({ select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: attempts, error: err }) }), in: async () => ({ data: progress, error: err }) }) }) }),
});
const base = { userId: 'u', moduleId: id(2) };

describe('checkLegacyAccess', () => {
  it('prerrequisito sin 100 %: niega con el titulo', async () => {
    const g = await checkLegacyAccess({ ...base, db: mkDb([id(1)]), admin: mkAdmin([{ module_id: id(1), score_percent: 40 }], [{ module_id: id(1), best_score: 40 }]) });
    expect(g).toEqual({ allowed: false, message: 'Todavía no puedes abrir esta lección. Primero domina «Uno» al 100 %.' });
  });
  it('100 % en un intento terminado O en student_progress: abre', async () => {
    expect(await checkLegacyAccess({ ...base, db: mkDb([id(1)]), admin: mkAdmin([{ module_id: id(1), score_percent: 100 }], []) })).toEqual({ allowed: true });
    expect(await checkLegacyAccess({ ...base, db: mkDb([id(1)]), admin: mkAdmin([], [{ module_id: id(1), best_score: '100' }]) })).toEqual({ allowed: true });
    expect((await checkLegacyAccess({ ...base, db: mkDb([id(1)]), admin: mkAdmin([{ module_id: id(1), score_percent: 99.9 }], []) })).allowed).toBe(false);
  });
  it('un modulo sin prerrequisitos (o que se tiene a si mismo) abre sin leer intentos', async () => {
    const admin = { from: vi.fn() };
    expect(await checkLegacyAccess({ ...base, db: mkDb([]), admin })).toEqual({ allowed: true });
    expect(await checkLegacyAccess({ ...base, db: mkDb([id(2)]), admin })).toEqual({ allowed: true });
    expect(admin.from).not.toHaveBeenCalled();
  });
  it('fallas de lectura o sin llave de servicio: NO bloquea y se registra', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await checkLegacyAccess({ ...base, db: mkDb([id(1)]), admin: null })).toEqual({ allowed: true });
    expect(await checkLegacyAccess({ ...base, db: mkDb(null, { message: 'boom' }), admin: mkAdmin([], []) })).toEqual({ allowed: true });
    expect(await checkLegacyAccess({ ...base, db: mkDb([id(1)]), admin: mkAdmin([], [], { message: 'boom' }) })).toEqual({ allowed: true });
    expect(await checkLegacyAccess({ ...base, db: {} as any, admin: mkAdmin([], []) })).toEqual({ allowed: true });
    expect(err).toHaveBeenCalledTimes(4);
    err.mockRestore();
  });
});
