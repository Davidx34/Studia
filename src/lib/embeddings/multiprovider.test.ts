import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { embedChain, embedProviderForProfile, resolveEmbedBaseUrl, resolveEmbedProvider, parseEmbedOrder, EMBED_PROVIDERS, embedProviderById } from './providers';
import { embedBatch } from './client';
import { embedTexts } from './router';
import { HealthTracker } from '@/lib/ai/gateway/health';
import { buildAiStatus } from '@/lib/ai/gateway/status';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

const vec = (dims: number, seed = 1) => Array.from({ length: dims }, (_, i) => ((i * seed) % 7) + 1);
const okData = (n: number, dims: number) => new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: vec(dims, i + 1) })) }), { status: 200 });
const err = (status: number, body = '{}', headers: Record<string, string> = {}) => new Response(body, { status, headers });

function fakeFetch(byHost: Record<string, (url: string, init: any) => Response>) {
  const calls: { host: string; body: any; headers: any }[] = [];
  const f = (async (url: any, init: any) => {
    const u = String(url);
    const host = Object.keys(byHost).find((h) => u.includes(h));
    if (!host) throw new Error('destino inesperado ' + u);
    calls.push({ host, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
    return byHost[host](u, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const CF = { CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'acc123' };
const VOY = { VOYAGE_API_KEY: 'voy-key' };

describe('catalogo de embeddings', () => {
  it('un proveedor solo esta activo con TODAS sus variables (Cloudflare necesita token y cuenta)', () => {
    expect(embedChain({ CLOUDFLARE_API_TOKEN: 'x' })).toEqual([]);
    expect(embedChain(CF).map((p) => p.id)).toEqual(['cloudflare']);
  });

  it('orden por defecto: Gemini, Cloudflare, Voyage, Mistral; EMBED_CHAIN lo reemplaza', () => {
    const env = { GEMINI_API_KEY: 'g', ...CF, ...VOY, MISTRAL_API_KEY: 'm' };
    expect(embedChain(env).map((p) => p.id)).toEqual(['gemini', 'cloudflare', 'voyage', 'mistral']);
    expect(embedChain({ ...env, EMBED_CHAIN: 'voyage, cloudflare, inventado' }).map((p) => p.id)).toEqual(['voyage', 'cloudflare']);
    expect(parseEmbedOrder('A, b ,')).toEqual([]);
  });

  it('Jina (solo uso no comercial) NO entra por descuido: hace falta pedirlo', () => {
    const env = { JINA_API_KEY: 'j', GEMINI_API_KEY: 'g' };
    expect(embedChain(env).map((p) => p.id)).toEqual(['gemini']);
    expect(embedChain({ ...env, EMBED_ALLOW_NONCOMMERCIAL: 'on' }).map((p) => p.id)).toEqual(['gemini', 'jina']);
    expect(embedChain({ ...env, EMBED_CHAIN: 'jina' }).map((p) => p.id)).toEqual(['jina']);
    expect(embedProviderById('jina')!.commercialOk).toBe(false);
  });

  it('el proveedor propio toma modelo y dimensiones del entorno y exige que esten bien', () => {
    const base = { AI_EMBED_CUSTOM_API_KEY: 'k', AI_EMBED_CUSTOM_BASE_URL: 'https://mi.example.com/v1/', AI_EMBED_CUSTOM_MODEL: 'nomic', AI_EMBED_CUSTOM_DIMS: '768' };
    const p = embedChain(base)[0];
    expect(p).toMatchObject({ id: 'custom', model: 'nomic', dims: 768, profile: 'custom-embed:nomic:768' });
    expect(resolveEmbedBaseUrl(p, base)).toBe('https://mi.example.com/v1');
    expect(embedChain({ ...base, AI_EMBED_CUSTOM_DIMS: 'abc' })).toEqual([]);
    expect(resolveEmbedProvider(EMBED_PROVIDERS.find((x) => x.id === 'custom')!, { ...base, AI_EMBED_CUSTOM_MODEL: '' })).toBeNull();
  });

  it('cada perfil identifica a su proveedor; el perfil de Gemini es el que ya esta indexado', () => {
    expect(embedProviderForProfile('gemini-embedding-001:768:rt', { GEMINI_API_KEY: 'g' })?.id).toBe('gemini');
    expect(embedProviderForProfile('cloudflare-bge-m3:1024', CF)?.id).toBe('cloudflare');
    expect(embedProviderForProfile('cloudflare-bge-m3:1024', {})).toBeNull();
  });
});

describe('embedBatch: forma de cada API', () => {
  it('Cloudflare (OpenAI compatible): URL con la cuenta, llave en cabecera, lote en UNA peticion y vectores normalizados', async () => {
    const p = embedChain(CF)[0];
    const { f, calls } = fakeFetch({ 'api.cloudflare.com': () => okData(3, 1024) });
    const r = await embedBatch(p, ['a', 'b', 'c'], 'document', CF, f);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ model: '@cf/baai/bge-m3', input: ['a', 'b', 'c'] });
    expect(calls[0].headers.Authorization).toBe('Bearer cf-token');
    expect(r.ok && r.vectors).toHaveLength(3);
    expect(r.ok && Math.hypot(...r.vectors[0])).toBeCloseTo(1);
  });

  it('la URL de Cloudflare lleva el ID de cuenta y no se filtra la llave', async () => {
    const p = embedChain(CF)[0];
    let url = '';
    const f = (async (u: any) => ((url = String(u)), okData(1, 1024))) as unknown as typeof fetch;
    await embedBatch(p, ['x'], 'query', CF, f);
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1/embeddings');
    expect(url).not.toContain('cf-token');
  });

  it('Voyage manda input_type segun el rol y la dimension pedida', async () => {
    const p = embedChain(VOY)[0];
    const { f, calls } = fakeFetch({ 'api.voyageai.com': () => okData(1, 1024) });
    await embedBatch(p, ['q'], 'query', VOY, f);
    await embedBatch(p, ['d'], 'document', VOY, f);
    expect(calls[0].body).toMatchObject({ input_type: 'query', output_dimension: 1024, model: 'voyage-3.5-lite' });
    expect(calls[1].body.input_type).toBe('document');
  });

  it('Jina manda task retrieval.query / retrieval.passage y 768 dimensiones', async () => {
    const env = { JINA_API_KEY: 'j', EMBED_CHAIN: 'jina' };
    const p = embedChain(env)[0];
    const { f, calls } = fakeFetch({ 'api.jina.ai': () => okData(1, 768) });
    await embedBatch(p, ['q'], 'query', env, f);
    await embedBatch(p, ['d'], 'document', env, f);
    expect(calls[0].body).toMatchObject({ task: 'retrieval.query', dimensions: 768 });
    expect(calls[1].body.task).toBe('retrieval.passage');
  });

  it('Gemini no tiene lotes: una llamada por texto con la llave en cabecera', async () => {
    const env = { GEMINI_API_KEY: 'gk' };
    const p = embedChain(env)[0];
    const { f, calls } = fakeFetch({ 'generativelanguage.googleapis.com': () => new Response(JSON.stringify({ embedding: { values: vec(768) } }), { status: 200 }) });
    const r = await embedBatch(p, ['a'], 'document', env, f);
    expect(calls[0].body.taskType).toBe('RETRIEVAL_DOCUMENT');
    expect(calls[0].headers['x-goog-api-key']).toBe('gk');
    expect(r.ok && r.vectors[0]).toHaveLength(768);
    // un lote mayor que maxBatch se rechaza (el enrutador lo parte)
    expect(await embedBatch(p, ['a', 'b'], 'document', env, f)).toMatchObject({ ok: false, kind: 'bad_request' });
  });

  it('valida cantidad y dimensiones: una respuesta que no cuadra no es utilizable', async () => {
    const p = embedChain(CF)[0];
    const bad = (n: number, dims: number) => fakeFetch({ 'api.cloudflare.com': () => okData(n, dims) }).f;
    expect(await embedBatch(p, ['a', 'b'], 'document', CF, bad(1, 1024))).toMatchObject({ ok: false, kind: 'unparseable' }); // faltan vectores
    expect(await embedBatch(p, ['a'], 'document', CF, bad(1, 768))).toMatchObject({ ok: false, kind: 'unparseable' }); // dimensiones distintas
  });

  it('acepta el formato { result: { data: [[...]] } } de Cloudflare', async () => {
    const p = embedChain(CF)[0];
    const f = (async () => new Response(JSON.stringify({ result: { data: [vec(1024)] } }), { status: 200 })) as unknown as typeof fetch;
    expect((await embedBatch(p, ['a'], 'document', CF, f)).ok).toBe(true);
  });

  it('clasifica los fallos como la pasarela de texto y nunca lanza', async () => {
    const p = embedChain(CF)[0];
    const run = (status: number, body = '{}', h: Record<string, string> = {}) => embedBatch(p, ['a'], 'document', CF, fakeFetch({ 'api.cloudflare.com': () => err(status, body, h) }).f);
    expect(await run(429, 'daily limit exceeded: neurons per day')).toMatchObject({ kind: 'rate_daily' });
    expect(await run(429, 'slow down', { 'retry-after': '3' })).toMatchObject({ kind: 'rate_minute', retryAfterMs: 3000 });
    expect(await run(401)).toMatchObject({ kind: 'auth' });
    expect(await run(503)).toMatchObject({ kind: 'server' });
    const boom = (async () => {
      throw new Error('red');
    }) as unknown as typeof fetch;
    expect(await embedBatch(p, ['a'], 'document', CF, boom)).toMatchObject({ ok: false, kind: 'server' });
  });
});

describe('embedTexts: enrutador', () => {
  const ENV = { GEMINI_API_KEY: 'g', ...CF, ...VOY };

  it('parte en lotes del tamano del proveedor: 70 textos en Cloudflare (lote 32) = 3 peticiones', async () => {
    const { f, calls } = fakeFetch({
      'api.cloudflare.com': (_u, init) => okData(JSON.parse(init.body).input.length, 1024),
    });
    const r = await embedTexts(Array.from({ length: 70 }, (_, i) => `t${i}`), 'document', { only: ['cloudflare'], deps: { env: ENV, fetchImpl: f, health: new HealthTracker() } });
    expect(r.ok && r.vectors).toHaveLength(70);
    expect(calls.map((c) => c.body.input.length)).toEqual([32, 32, 6]);
    expect(r.ok && r.profile).toBe('cloudflare-bge-m3:1024');
  });

  it('si un proveedor falla a mitad, TODO el conjunto se rehace con el siguiente (nunca vectores mezclados)', async () => {
    let cfCalls = 0;
    const { f } = fakeFetch({
      'api.cloudflare.com': (_u, init) => (++cfCalls === 2 ? err(500) : okData(JSON.parse(init.body).input.length, 1024)),
      'api.voyageai.com': (_u, init) => okData(JSON.parse(init.body).input.length, 1024),
    });
    const r = await embedTexts(Array.from({ length: 40 }, (_, i) => `t${i}`), 'document', { only: ['cloudflare', 'voyage'], deps: { env: ENV, fetchImpl: f, health: new HealthTracker() } });
    expect(r.ok && r.provider).toBe('voyage');
    expect(r.ok && r.vectors).toHaveLength(40);
    expect(r.attempts.map((a) => [a.provider, a.ok])).toEqual([['embed:cloudflare', false], ['embed:voyage', true]]);
  });

  it('cuota diaria agotada: el proveedor queda apartado y la siguiente llamada ni lo intenta', async () => {
    const h = new HealthTracker();
    const { f, calls } = fakeFetch({
      'api.cloudflare.com': () => err(429, 'neurons per day exceeded'),
      'api.voyageai.com': (_u, init) => okData(JSON.parse(init.body).input.length, 1024),
    });
    const opts = { only: ['cloudflare', 'voyage'], deps: { env: ENV, fetchImpl: f, health: h } };
    await embedTexts(['a'], 'document', opts);
    calls.length = 0;
    const r = await embedTexts(['b'], 'document', opts);
    expect(r.ok && r.provider).toBe('voyage');
    expect(calls.map((c) => c.host)).toEqual(['api.voyageai.com']);
  });

  it('un perfil concreto solo usa a su proveedor (para consultar contra fragmentos de ese perfil)', async () => {
    const { f, calls } = fakeFetch({ 'api.voyageai.com': () => okData(1, 1024), 'api.cloudflare.com': () => okData(1, 1024) });
    const r = await embedTexts(['q'], 'query', { profile: 'voyage-3.5-lite:1024', deps: { env: ENV, fetchImpl: f, health: new HealthTracker() } });
    expect(r.ok && r.provider).toBe('voyage');
    expect(calls.map((c) => c.host)).toEqual(['api.voyageai.com']);
    expect(await embedTexts(['q'], 'query', { profile: 'perfil-inexistente', deps: { env: ENV, fetchImpl: f, health: new HealthTracker() } })).toMatchObject({ ok: false, reason: 'no_providers' });
  });

  it('sin proveedores: no_providers; todos apartados: all_unavailable; todos fallan: exhausted', async () => {
    expect(await embedTexts(['a'], 'document', { deps: { env: {}, health: new HealthTracker() } })).toMatchObject({ ok: false, reason: 'no_providers' });
    const h = new HealthTracker();
    const { f } = fakeFetch({ 'api.cloudflare.com': () => err(401) });
    const opts = { only: ['cloudflare'], deps: { env: ENV, fetchImpl: f, health: h } };
    expect(await embedTexts(['a'], 'document', opts)).toMatchObject({ ok: false, reason: 'exhausted' });
    expect(await embedTexts(['a'], 'document', opts)).toMatchObject({ ok: false, reason: 'all_unavailable' });
  });
});

describe('estado para el panel /dev', () => {
  it('muestra proveedores de embeddings y perfiles, pero nunca llaves ni el ID de cuenta', () => {
    const env = { GEMINI_API_KEY: 'AIza_SECRETO_GEMINI_000', CLOUDFLARE_API_TOKEN: 'cf_SECRETO_TOKEN', CLOUDFLARE_ACCOUNT_ID: 'acct_SECRETO_ID', VOYAGE_API_KEY: 'pa-SECRETO_VOY' };
    const s = buildAiStatus(env, new HealthTracker());
    const json = JSON.stringify(s);
    for (const secret of ['SECRETO_GEMINI', 'SECRETO_TOKEN', 'SECRETO_ID', 'SECRETO_VOY']) expect(json).not.toContain(secret);
    expect(s.embeddings.providers.filter((p) => p.configured).map((p) => p.id)).toEqual(['gemini', 'cloudflare', 'voyage']);
    expect(s.embeddings.chain).toEqual(['gemini-embedding-001:768:rt', 'cloudflare-bge-m3:1024', 'voyage-3.5-lite:1024']);
  });

  it('el codigo del navegador no importa el enrutador de embeddings y el flujo actual no cambia', () => {
    expect(read('src/lib/materials/textProcessing.ts')).not.toContain('embeddings/router');
    expect(read('src/lib/rag/retrieve.ts')).not.toContain('embeddings/router');
    expect(read('src/app/(student)/lesson/[id]/page.tsx')).not.toContain('embeddings/');
  });
});
