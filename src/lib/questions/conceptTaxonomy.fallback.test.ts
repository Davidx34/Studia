import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/questions/cohereGeneration', () => ({
  getRagContext: vi.fn(async () => 'material del modulo'),
}));

import { getOrCreateModuleConcepts } from './conceptTaxonomy';

const CONCEPTOS = JSON.stringify({ concepts: [{ tag: 'oferta', label: 'Oferta' }, { tag: 'demanda', label: 'Demanda' }] });

function fakeSupabase() {
  const guardados: { tag: string; label: string }[] = [];
  return {
    guardados,
    supabase: {
      from(table: string) {
        if (table === 'classroom_concepts') {
          return {
            select: () => ({ eq: async () => ({ data: guardados, error: null }) }),
            upsert: async (rows: any[]) => {
              guardados.push(...rows.map((r) => ({ tag: r.tag, label: r.label })));
              return { error: null };
            },
          };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { classroom_id: 'c', description: 'd' }, error: null }) }) }) };
      },
    } as any,
  };
}

beforeEach(() => {
  process.env.COHERE_API_KEY = 'c';
  process.env.OPENROUTER_API_KEY = 'o';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COHERE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

describe('taxonomia de conceptos con respaldo', () => {
  it('Cohere con la red caida: NO lanza y los conceptos salen de OpenRouter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        if (String(url).includes('cohere.com')) throw new TypeError('fetch failed');
        return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: CONCEPTOS } }] }), { status: 200 });
      })
    );
    const { supabase, guardados } = fakeSupabase();
    const r = await getOrCreateModuleConcepts(supabase, 'm1', 'Modulo');
    expect(r.map((c) => c.tag).sort()).toEqual(['demanda', 'oferta']);
    expect(guardados).toHaveLength(2);
  });

  it('sin ningun proveedor disponible devuelve [] (no bloquea la generacion) y no lanza', async () => {
    delete process.env.OPENROUTER_API_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const { supabase } = fakeSupabase();
    await expect(getOrCreateModuleConcepts(supabase, 'm1', 'Modulo')).resolves.toEqual([]);
  });
});
