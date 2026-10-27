import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fuseVariants, relativeCutoff, dropNearDuplicates, packByRelevance, joinContext, type Retrieved } from './fusion';
import { buildQueryVariants } from './queries';
import { retrieveContext } from './retrieve';
import { l2Normalize, embedWithGemini, classifyEmbedFailure, EMBEDDING_PROFILE, LEGACY_EMBEDDING_PROFILE, QUERYABLE_PROFILES } from '@/lib/embeddings/embed';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

const R = (id: string, extra: Partial<Retrieved> = {}): Retrieved => ({
  chunk_id: id,
  content: `contenido distinto numero ${id} sobre un tema particular con palabras propias ${id}${id}`,
  material_id: 'm1',
  chunk_index: Number(id.replace(/\D/g, '')) || 0,
  score: 1,
  ...extra,
});

describe('embeddings: normalizacion y peticion', () => {
  it('l2Normalize deja norma 1 y no toca el vector cero', () => {
    const v = l2Normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(Math.hypot(...l2Normalize([1, 2, 3, 4]))).toBeCloseTo(1);
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
  });

  it('la peticion lleva taskType, 768 dimensiones y la llave en la CABECERA (no en la URL)', async () => {
    let seen: any;
    const f = (async (url: any, init: any) => {
      seen = { url: String(url), init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ embedding: { values: Array.from({ length: 768 }, (_, i) => (i === 0 ? 3 : 4 * (i === 1 ? 1 : 0))) } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await embedWithGemini('hola', 'RETRIEVAL_QUERY', { apiKey: 'SECRETA', fetchImpl: f });
    expect(seen.body.taskType).toBe('RETRIEVAL_QUERY');
    expect(seen.body.outputDimensionality).toBe(768);
    expect(seen.init.headers['x-goog-api-key']).toBe('SECRETA');
    expect(seen.url).not.toContain('SECRETA');
    expect(seen.url).not.toContain('key=');
    expect(r.ok && Math.hypot(...r.values)).toBeCloseTo(1); // normalizado
  });

  it('sin tipo (para reproducir la linea base de las evaluaciones) no manda taskType', async () => {
    let body: any;
    const f = (async (_u: any, init: any) => ((body = JSON.parse(init.body)), new Response(JSON.stringify({ embedding: { values: new Array(768).fill(1) } }), { status: 200 }))) as unknown as typeof fetch;
    await embedWithGemini('x', null, { apiKey: 'k', fetchImpl: f, normalize: false });
    expect(body.taskType).toBeUndefined();
  });

  it('respuestas invalidas y fallos se clasifican sin lanzar', async () => {
    const mk = (status: number, body = '{}') => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await embedWithGemini('x', 'RETRIEVAL_DOCUMENT', { apiKey: 'k', fetchImpl: mk(429, 'RESOURCE_EXHAUSTED') })).toMatchObject({ ok: false, kind: 'quota' });
    expect(await embedWithGemini('x', 'RETRIEVAL_DOCUMENT', { apiKey: 'k', fetchImpl: mk(429, 'slow down') })).toMatchObject({ ok: false, kind: 'rate' });
    expect(await embedWithGemini('x', 'RETRIEVAL_DOCUMENT', { apiKey: 'k', fetchImpl: mk(503) })).toMatchObject({ ok: false, kind: 'server' });
    expect(await embedWithGemini('x', 'RETRIEVAL_DOCUMENT', { apiKey: 'k', fetchImpl: mk(200, JSON.stringify({ embedding: { values: [1, 2] } })) })).toMatchObject({ ok: false, kind: 'bad_response' });
    expect(await embedWithGemini('x', 'RETRIEVAL_DOCUMENT', {})).toMatchObject({ ok: false, kind: expect.stringMatching(/no_key|empty/) });
    expect(await embedWithGemini('   ', 'RETRIEVAL_DOCUMENT', { apiKey: 'k' })).toMatchObject({ ok: false, kind: 'empty' });
    const boom = (async () => {
      throw new Error('red');
    }) as unknown as typeof fetch;
    expect(await embedWithGemini('x', 'RETRIEVAL_DOCUMENT', { apiKey: 'k', fetchImpl: boom })).toMatchObject({ ok: false, kind: 'server' });
    expect(classifyEmbedFailure(400, '')).toBe('bad_response');
  });

  it('perfiles: los nuevos y los anteriores a la 068 son consultables', () => {
    expect(EMBEDDING_PROFILE).toBe('gemini-embedding-001:768:rt');
    expect(LEGACY_EMBEDDING_PROFILE).toBe('gemini-embedding-001:768:legacy');
    expect(QUERYABLE_PROFILES).toEqual([EMBEDDING_PROFILE, LEGACY_EMBEDDING_PROFILE]);
  });
});

describe('consultas del modulo', () => {
  it('hasta 3 variantes distintas: descripcion completa, palabras clave y titulo', () => {
    const v = buildQueryVariants({ title: 'Utilidad Marshalliana', description: 'Maximizacion con restriccion presupuestaria', keywords: ['lagrange', 'demanda', 'utilidad'] });
    expect(v).toEqual(['Utilidad Marshalliana. Maximizacion con restriccion presupuestaria', 'lagrange, demanda, utilidad', 'Utilidad Marshalliana']);
  });

  it('sin descripcion ni palabras clave queda solo el titulo (sin duplicados)', () => {
    expect(buildQueryVariants({ title: 'Roma', description: '', keywords: null })).toContain('Roma');
    expect(buildQueryVariants({ title: 'Roma' }).filter((x) => x === 'Roma')).toHaveLength(1);
  });

  it('una sola palabra clave no basta para una variante; el texto largo se recorta', () => {
    expect(buildQueryVariants({ title: 'A', keywords: ['solo'] })).not.toContain('solo');
    expect(buildQueryVariants({ title: 'x'.repeat(2000) })[0].length).toBeLessThanOrEqual(400);
  });
});

describe('fusion y empaquetado', () => {
  it('fuseVariants: lo que sale bien en VARIAS consultas sube', () => {
    const a = [R('c1'), R('c2'), R('c3')];
    const b = [R('c9'), R('c2'), R('c8')];
    const fused = fuseVariants([a, b]);
    expect(fused[0].chunk_id).toBe('c2'); // segundo en ambas > primero en una sola
    expect(fused.find((c) => c.chunk_id === 'c2')!.votes).toBe(2);
  });

  it('relativeCutoff: descarta lo flojo pero nunca deja menos de minKeep', () => {
    const list = [1, 0.9, 0.8, 0.7, 0.01, 0.005].map((fused, i) => ({ ...R('c' + i), fused, votes: 1 }));
    expect(relativeCutoff(list, 0.25, 4).map((c) => c.fused)).toEqual([1, 0.9, 0.8, 0.7]);
    expect(relativeCutoff(list.slice(0, 3), 0.99, 4)).toHaveLength(3);
  });

  it('dropNearDuplicates: conserva el mas relevante de dos fragmentos casi iguales', () => {
    const texto = 'la restriccion presupuestaria define el conjunto de cestas que el consumidor puede comprar con su ingreso dado los precios vigentes';
    const out = dropNearDuplicates([{ content: texto + ' primero' }, { content: texto + ' segundo' }, { content: 'otro tema completamente distinto sobre la curva de oferta de la empresa competitiva en el corto plazo' }]);
    expect(out).toHaveLength(2);
    expect(out[0].content).toContain('primero');
  });

  it('packByRelevance: respeta el presupuesto, salta lo que no cabe y devuelve en orden de DOCUMENTO', () => {
    const chunks = [
      { content: 'a'.repeat(900), material_id: 'm1', chunk_index: 5 }, // mas relevante
      { content: 'b'.repeat(900), material_id: 'm1', chunk_index: 2 },
      { content: 'c'.repeat(900), material_id: 'm1', chunk_index: 9 }, // no cabe
      { content: 'd'.repeat(50), material_id: 'm1', chunk_index: 1 }, // corto: cabe despues de saltar el anterior
    ];
    const out = packByRelevance(chunks, 1900, 8);
    expect(out.map((c) => c.chunk_index)).toEqual([1, 2, 5]);
    expect(joinContext(out).length).toBeLessThanOrEqual(1900 + 4);
  });

  it('packByRelevance: el primero que excede el limite se incluye truncado; maxChunks manda', () => {
    expect(packByRelevance([{ content: 'x'.repeat(500), material_id: 'm', chunk_index: 0 }], 100)[0].content).toHaveLength(100);
    const many = Array.from({ length: 20 }, (_, i) => ({ content: 'z' + i, material_id: 'm', chunk_index: i }));
    expect(packByRelevance(many, 10_000, 5)).toHaveLength(5);
  });
});

// Supabase simulado: content_modules y las llamadas a la funcion hibrida.
function fakeSupabase(opts: { moduleRow?: any; rpc: (name: string, args: any) => { data?: any[]; error?: any } }) {
  const rpcCalls: { name: string; args: any }[] = [];
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: opts.moduleRow ?? null }) }) }) }),
    rpc: vi.fn(async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      return opts.rpc(name, args);
    }),
  };
  return { client, rpcCalls };
}
const MODULE = { title: 'Utilidad', description: 'desc del modulo', classroom_id: 'cls', source_material_ids: [], topic_keywords: ['a', 'b'] };
const row = (id: string, idx: number, score = 0.03) => ({ chunk_id: id, content: `texto unico del fragmento ${id} `.repeat(6), material_id: 'm1', chunk_index: idx, filename: 'f.pdf', score });

describe('retrieveContext', () => {
  it('hibrido: una busqueda por variante, con embedding, texto y los perfiles consultables', async () => {
    const { client, rpcCalls } = fakeSupabase({ moduleRow: MODULE, rpc: () => ({ data: [row('c1', 1), row('c2', 2)] }) });
    const r = await retrieveContext(client, 'mod', { charLimit: 16000, embed: async () => [0.1, 0.2] });
    expect(rpcCalls).toHaveLength(3);
    expect(rpcCalls[0].name).toBe('match_material_chunks_hybrid');
    expect(rpcCalls[0].args).toMatchObject({ query_embedding: [0.1, 0.2], classroom_id_filter: 'cls', material_ids: null, vector_models: QUERYABLE_PROFILES });
    expect(typeof rpcCalls[0].args.query_text).toBe('string');
    expect(r).toMatchObject({ mode: 'hybrid', variants: 3, scoped: false });
    expect(r!.chunkIds.sort()).toEqual(['c1', 'c2']);
  });

  it('consultas propias (evaluaciones): se usan EN LUGAR de las del modulo, conservando el aislamiento de la clase', async () => {
    const { client, rpcCalls } = fakeSupabase({ moduleRow: MODULE, rpc: () => ({ data: [row('c1', 1)] }) });
    const r = await retrieveContext(client, 'mod', { charLimit: 16000, embed: async () => [0.1], queries: ['derivada de x al cuadrado'] });
    expect(rpcCalls).toHaveLength(1); // una sola consulta, no las 3 variantes del modulo
    expect(rpcCalls[0].args.query_text).toBe('derivada de x al cuadrado');
    expect(rpcCalls[0].args.classroom_id_filter).toBe('cls');
    expect(r).toMatchObject({ variants: 1 });
    // una lista vacia no cuenta: se vuelve a las consultas del modulo
    const v = fakeSupabase({ moduleRow: MODULE, rpc: () => ({ data: [row('c1', 1)] }) });
    await retrieveContext(v.client, 'mod', { charLimit: 16000, embed: async () => [0.1], queries: [] });
    expect(v.rpcCalls).toHaveLength(3);
  });

  it('sin embeddings (sin cuota o sin llave): sigue buscando por TEXTO en vez de caer a los primeros fragmentos', async () => {
    const { client, rpcCalls } = fakeSupabase({ moduleRow: MODULE, rpc: () => ({ data: [row('c1', 1)] }) });
    const r = await retrieveContext(client, 'mod', { charLimit: 16000, embed: async () => null });
    expect(rpcCalls.every((c) => c.args.query_embedding === null)).toBe(true);
    expect(r?.mode).toBe('text_only');
  });

  it('material vinculado: se acota; si no da resultados se busca en toda la clase', async () => {
    const calls: any[] = [];
    const { client } = fakeSupabase({
      moduleRow: { ...MODULE, source_material_ids: ['m7'] },
      rpc: (_n, args) => {
        calls.push(args.material_ids);
        return { data: args.material_ids ? [] : [row('c1', 1)] };
      },
    });
    const r = await retrieveContext(client, 'mod', { charLimit: 16000, embed: async () => null });
    expect(calls.slice(0, 3).every((m) => Array.isArray(m))).toBe(true);
    expect(calls.slice(3).every((m) => m === null)).toBe(true);
    expect(r).toMatchObject({ scoped: false });
  });

  it('funcion de la base ausente o con error en TODAS las consultas -> null (el llamador usa el camino anterior)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = fakeSupabase({ moduleRow: MODULE, rpc: () => ({ error: { message: 'function does not exist' } }) });
    expect(await retrieveContext(client, 'mod', { charLimit: 16000, embed: async () => null })).toBeNull();
    warn.mockRestore();
  });

  it('modulo inexistente o sin resultados -> null', async () => {
    expect(await retrieveContext(fakeSupabase({ moduleRow: null, rpc: () => ({ data: [] }) }).client, 'x', { charLimit: 100 })).toBeNull();
    expect(await retrieveContext(fakeSupabase({ moduleRow: MODULE, rpc: () => ({ data: [] }) }).client, 'x', { charLimit: 100, embed: async () => null })).toBeNull();
  });

  it('estrategia forzada (evaluaciones): "text" no pide embeddings y "vector" no manda texto', async () => {
    const embed = vi.fn(async () => [1]);
    const t = fakeSupabase({ moduleRow: MODULE, rpc: () => ({ data: [row('c1', 1)] }) });
    await retrieveContext(t.client, 'mod', { charLimit: 16000, strategy: 'text', embed });
    expect(embed).not.toHaveBeenCalled();
    const v = fakeSupabase({ moduleRow: MODULE, rpc: () => ({ data: [row('c1', 1)] }) });
    const r = await retrieveContext(v.client, 'mod', { charLimit: 16000, strategy: 'vector', embed });
    expect(v.rpcCalls.every((c) => c.args.query_text === null)).toBe(true);
    expect(r?.mode).toBe('vector_only');
  });
});

describe('integracion', () => {
  it('getRagContext prueba la recuperacion hibrida y conserva el camino anterior como respaldo', () => {
    const src = read('src/lib/questions/cohereGeneration.ts');
    expect(src).toContain('retrieveContext(supabase, moduleId');
    expect(src).toContain('return getRagContextLegacy(supabase, moduleId)');
    expect(src).toContain('export async function getRagContextLegacy');
  });

  it('los fragmentos nuevos se calculan como DOCUMENTO y guardan su perfil', () => {
    const src = read('src/lib/materials/textProcessing.ts');
    expect(src).toContain("embedWithGemini(text, 'RETRIEVAL_DOCUMENT'");
    expect(src).toContain('embedding_model: EMBEDDING_PROFILE');
    // ya no se manda la llave por la URL
    expect(src).not.toMatch(/embedContent\?key=/);
  });

  it('la migracion 068 es aditiva, mantiene el control de acceso y no deja la funcion a anon', () => {
    const sql = read('supabase/migrations/068_hybrid_retrieval.sql');
    expect(sql).toContain("auth.role() = 'service_role'");
    expect(sql).toContain('c.teacher_id = auth.uid()');
    expect(sql).toContain('ce.student_id = auth.uid()');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.match_material_chunks_hybrid');
    expect(sql).toContain('FROM PUBLIC, anon');
    expect(sql).not.toMatch(/DROP |DELETE FROM/);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.match_material_chunks\(/);
    expect(sql).toContain("'gemini-embedding-001:768:legacy'");
  });
});
