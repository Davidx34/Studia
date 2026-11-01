import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// La IA se simula con un generador que cada prueba controla: mezcla preguntas buenas con otras bien formadas pero IMPOSIBLES de calificar (dos opciones iguales).
const gen = vi.hoisted(() => ({ make: null as null | ((count: number, callNo: number) => any[]), calls: 0 }));
vi.mock('@/lib/questions/cohereGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/questions/cohereGeneration')>()),
  getRagContext: vi.fn(async () => 'contexto del material'),
  normalizeGeneratedQuestion: (q: any) => q,
  callCohere: vi.fn(async (_prompt: string, count: number) => {
    gen.calls++;
    return gen.make!(count, gen.calls);
  }),
}));
vi.mock('@/lib/questions/conceptTaxonomy', () => ({
  getOrCreateModuleConcepts: vi.fn(async () => []),
  conceptTaxonomyPromptBlock: () => '',
}));

import { regenerateModulePool } from './regeneratePool';
import { MAX_MINIGAMES_PER_BATCH } from './minigameCatalog';

const good = (i: number) => ({ type: 'multiple_choice', q: `Buena ${i}`, opts: ['A. uno', 'B. dos', 'C. tres', 'D. cuatro'], ok: 0, exp: 'e', concept_tag: 'c' });
// Bien formada (pasa isValidQuestion) pero ambigua: dos opciones dicen lo mismo.
const ambiguous = (i: number) => ({ type: 'multiple_choice', q: `Ambigua ${i}`, opts: ['A. igual', 'B. igual', 'C. otra', 'D. mas'], ok: 0, exp: 'e', concept_tag: 'c' });

function fakeSupabase() {
  const log = { deletes: 0, inserted: [] as any[] };
  const supabase = {
    from(table: string) {
      if (table === 'content_modules') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'm1', classroom_id: 'c1', title: 'Modulo', description: null, minigame_types: null, configured_question_count: 10 }, error: null }) }) }) };
      }
      if (table === 'classroom_ai_config') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      return {
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        delete: () => ({ eq: async () => ((log.deletes++), { error: null }) }),
        insert: async (rows: any[]) => ((log.inserted.push(...rows)), { error: null }),
      };
    },
  };
  return { supabase, log };
}

beforeEach(() => {
  gen.calls = 0;
  process.env.COHERE_API_KEY = 'test';
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.JEV_GATE;
  vi.restoreAllMocks();
});

describe('regenerateModulePool con la compuerta JEV', () => {
  it('descarta las preguntas imposibles de calificar y guarda solo las buenas', async () => {
    // de cada tanda: 3 de cada 4 son buenas, 1 es ambigua
    gen.make = (count) => Array.from({ length: count }, (_, i) => (i % 4 === 3 ? ambiguous(i) : good(i)));
    const { supabase, log } = fakeSupabase();
    const r = await regenerateModulePool(supabase, 'm1', { mode: 'replace' });
    expect(r.ok).toBe(true);
    expect(log.inserted.length).toBeGreaterThan(0);
    expect(log.inserted.some((x) => /Ambigua/.test(x.q))).toBe(false);
    expect(log.inserted.every((x) => /Buena/.test(x.q))).toBe(true);
    // los contadores reflejan lo guardado
    expect(r.active! + r.backup!).toBe(log.inserted.length);
  });
  it('el descarte se registra con el motivo y SIN el enunciado', async () => {
    gen.make = (count) => Array.from({ length: count }, (_, i) => (i === 0 ? ambiguous(i) : good(i)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { supabase } = fakeSupabase();
    await regenerateModulePool(supabase, 'm1', { mode: 'replace' });
    const calls = warn.mock.calls.filter((c) => c[0] === '[JEV_REJECTED:REGENERATE]');
    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls)).toContain('dicen lo mismo');
    expect(JSON.stringify(calls)).not.toContain('Ambigua');
  });
  it('PROPIEDAD CLAVE: si TODO el lote es imposible, devuelve error y NO borra el pool que ya habia', async () => {
    gen.make = (count) => Array.from({ length: count }, (_, i) => ambiguous(i));
    const { supabase, log } = fakeSupabase();
    const r = await regenerateModulePool(supabase, 'm1', { mode: 'replace' });
    expect(r).toEqual({ ok: false, error: 'No se genero ninguna pregunta valida' });
    expect(log.deletes).toBe(0);
    expect(log.inserted).toHaveLength(0);
  });
  it('con JEV_GATE=off pasa todo, como antes (interruptor de emergencia)', async () => {
    process.env.JEV_GATE = 'off';
    gen.make = (count) => Array.from({ length: count }, (_, i) => ambiguous(i));
    const { supabase, log } = fakeSupabase();
    const r = await regenerateModulePool(supabase, 'm1', { mode: 'replace' });
    expect(r.ok).toBe(true);
    expect(log.inserted.length).toBeGreaterThan(0);
    expect(log.inserted.every((x) => /Ambigua/.test(x.q))).toBe(true);
  });
  it('un lote bueno pasa entero (la compuerta no estorba a lo normal)', async () => {
    gen.make = (count) => Array.from({ length: count }, (_, i) => good(i));
    const { supabase, log } = fakeSupabase();
    const r = await regenerateModulePool(supabase, 'm1', { mode: 'replace' });
    // la tanda activa pide las 10 clasicas MAS los minijuegos que la clase permite (el generador simulado los devuelve como clasicas)
    expect(r).toMatchObject({ ok: true, active: 10 + MAX_MINIGAMES_PER_BATCH, backup: 10 });
    expect(log.inserted).toHaveLength(20 + MAX_MINIGAMES_PER_BATCH);
  });
});
