import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function weight(env?: string) {
  vi.resetModules();
  if (env === undefined) vi.unstubAllEnvs();
  else vi.stubEnv('RAG_TEXT_WEIGHT', env);
  return (await import('./retrieve')).RAG_TEXT_WEIGHT;
}

describe('peso del texto en la busqueda hibrida', () => {
  it('por defecto es 0,3 (provisional: el texto mete ruido con peso 1)', async () => {
    expect(await weight()).toBe(0.3);
  });

  it('RAG_TEXT_WEIGHT lo cambia sin desplegar; valores invalidos o fuera de rango se ignoran', async () => {
    expect(await weight('0.5')).toBe(0.5);
    expect(await weight('0')).toBe(0);
    expect(await weight('2')).toBe(2);
    expect(await weight('abc')).toBe(0.3);
    expect(await weight('-1')).toBe(0.3);
    expect(await weight('9')).toBe(0.3);
    expect(await weight('')).toBe(0.3);
  });

  it('la recuperacion manda los pesos a la base', async () => {
    vi.resetModules();
    const { retrieveContext } = await import('./retrieve');
    const calls: any[] = [];
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { title: 'T', description: 'd', classroom_id: 'c', source_material_ids: [], topic_keywords: [] } }) }) }) }),
      rpc: async (_n: string, args: any) => (calls.push(args), { data: [{ chunk_id: 'a', content: 'x'.repeat(50), material_id: 'm', chunk_index: 1, score: 0.1 }] }),
    };
    await retrieveContext(client, 'mod', { charLimit: 1000, embed: async () => null });
    expect(calls[0]).toMatchObject({ vector_weight: 1, text_weight: 0.3 });
  });

  it('la migracion 069 reemplaza la funcion con pesos por defecto 1/1, mantiene el control de acceso y cierra anon', () => {
    const sql = read('supabase/migrations/069_hybrid_weights.sql');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.match_material_chunks_hybrid(vector, text, uuid, uuid[], integer, text[], integer);');
    expect(sql).toContain('vector_weight double precision DEFAULT 1.0');
    expect(sql).toContain('text_weight double precision DEFAULT 1.0');
    expect(sql).toContain("auth.role() = 'service_role'");
    expect(sql).toContain('ce.student_id = auth.uid()');
    expect(sql).toContain('FROM PUBLIC, anon');
    expect(sql).toContain('vector_weight / (rrf_k + vec.rk)');
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE/);
  });
});
