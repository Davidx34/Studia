import { describe, it, expect } from 'vitest';
import { HealthTracker, openForMs } from './health';
import { classifyFailure, callCandidate } from './client';
import { chainFor, parseChain, DEFAULT_CHAINS, resolveBaseUrl, providerById } from './providers';
import { routeText } from './router';
import type { Candidate } from './types';

const A: Candidate = { provider: 'groq', model: 'm-a' };
const B: Candidate = { provider: 'cerebras', model: 'm-b' };
const C: Candidate = { provider: 'mistral', model: 'm-c' };
const ENV = { GROQ_API_KEY: 'g', CEREBRAS_API_KEY: 'c', MISTRAL_API_KEY: 'm' };

const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200 });
const err = (status: number, body = '{}', headers: Record<string, string> = {}) => new Response(body, { status, headers });

// fetch que responde segun el host y cuenta las llamadas.
function fakeFetch(byHost: Record<string, (url: string, init: any) => Response>) {
  const calls: string[] = [];
  const f = (async (url: any, init: any) => {
    const u = String(url);
    const host = Object.keys(byHost).find((h) => u.includes(h));
    if (!host) throw new Error('destino inesperado ' + u);
    calls.push(host);
    return byHost[host](u, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('clasificacion de fallos', () => {
  it('429 por minuto vs cuota diaria', () => {
    expect(classifyFailure(429, 'Rate limit reached, try again in 2s').kind).toBe('rate_minute');
    expect(classifyFailure(429, 'You exceeded your current quota: GenerateRequestsPerDayPerProjectPerModel').kind).toBe('rate_daily');
    expect(classifyFailure(429, 'Rate limit reached for tokens per day (TPD)').kind).toBe('rate_daily');
    expect(classifyFailure(429, '', '7200').kind).toBe('rate_daily'); // Retry-After de horas
    expect(classifyFailure(429, '', '12')).toEqual({ kind: 'rate_minute', retryAfterMs: 12_000 });
  });

  it('otros codigos', () => {
    expect(classifyFailure(401, '').kind).toBe('auth');
    expect(classifyFailure(403, '').kind).toBe('auth');
    expect(classifyFailure(402, '').kind).toBe('payment');
    expect(classifyFailure(404, '').kind).toBe('not_found');
    expect(classifyFailure(503, '').kind).toBe('server');
    expect(classifyFailure(400, '').kind).toBe('bad_request');
  });
});

describe('cortacircuito y orden adaptativo', () => {
  it('un fallo de servidor aislado no aparta; el segundo seguido si', () => {
    let t = 1_000_000;
    const h = new HealthTracker(() => t);
    h.failure(A, 'server');
    expect(h.isAvailable(A)).toBe(true);
    h.failure(A, 'server');
    expect(h.isAvailable(A)).toBe(false);
    t += 61_000;
    expect(h.isAvailable(A)).toBe(true);
  });

  it('cuota diaria: se aparta hasta el reinicio (con tope de 8 h)', () => {
    const t = Date.UTC(2026, 9, 11, 20, 0, 0); // 20:00 UTC -> faltan 4 h
    expect(openForMs('rate_daily', t, 1)).toBe(4 * 3_600_000);
    const t2 = Date.UTC(2026, 9, 11, 0, 5, 0); // faltan casi 24 h -> tope 8 h
    expect(openForMs('rate_daily', t2, 1)).toBe(8 * 3_600_000);
  });

  it('bad_request no ensucia el historial ni aparta', () => {
    const h = new HealthTracker();
    for (let i = 0; i < 10; i++) h.failure(A, 'bad_request');
    expect(h.isAvailable(A)).toBe(true);
    expect(h.get('groq:m-a').successEma).toBe(1);
  });

  it('con historial limpio el orden es el de la cadena; el que falla mucho cede el puesto', () => {
    const h = new HealthTracker();
    expect(h.rank([A, B, C]).map((c) => c.provider)).toEqual(['groq', 'cerebras', 'mistral']);
    for (let i = 0; i < 6; i++) h.failure(A, 'unparseable'); // no llega a apartarlo del todo en cada fallo, pero baja su puntaje
    h.success(A, 100);
    expect(h.rank([A, B, C])[0].provider).not.toBe('groq');
  });

  it('un candidato apartado no aparece en el ranking', () => {
    const h = new HealthTracker();
    h.failure(A, 'auth');
    expect(h.rank([A, B]).map((c) => c.provider)).toEqual(['cerebras']);
  });
});

describe('cadenas', () => {
  it('solo entran proveedores con llave', () => {
    expect(chainFor('judge', {}).length).toBe(0);
    const chain = chainFor('judge', { GROQ_API_KEY: 'x' });
    expect(chain.map((c) => c.provider)).toEqual(['groq']);
  });

  it('un proveedor con variables extra faltantes no entra (Cloudflare necesita la cuenta)', () => {
    expect(chainFor('generation', { CLOUDFLARE_API_TOKEN: 'x' })).toEqual([]);
    expect(chainFor('generation', { CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: 'acc' }).map((c) => c.provider)).toEqual(['cloudflare']);
  });

  it('Gemini no esta en las cadenas de generacion (su llave sostiene embeddings, juez y PDF)', () => {
    for (const task of ['generation', 'study'] as const) expect(DEFAULT_CHAINS[task].some((c) => c.provider === 'gemini')).toBe(false);
    expect(DEFAULT_CHAINS.judge.some((c) => c.provider === 'gemini')).toBe(true);
  });

  it('AI_CHAIN_<TAREA> reemplaza la cadena y descarta lo invalido', () => {
    const env = { ...ENV, AI_CHAIN_JUDGE: 'mistral:otro-modelo, inventado:x, groq:llama-x' };
    expect(chainFor('judge', env)).toEqual([
      { provider: 'mistral', model: 'otro-modelo' },
      { provider: 'groq', model: 'llama-x' },
    ]);
    expect(parseChain('sin-dos-puntos,groq:')).toEqual([]);
  });

  it('el proveedor propio exige su URL base', () => {
    const p = providerById('custom')!;
    expect(resolveBaseUrl(p, { AI_CUSTOM_API_KEY: 'k' })).toBeNull();
    expect(resolveBaseUrl(p, { AI_CUSTOM_API_KEY: 'k', AI_CUSTOM_BASE_URL: 'https://mi-litellm.example.com/v1/' })).toBe('https://mi-litellm.example.com/v1');
  });
});

describe('callCandidate', () => {
  it('manda el modelo, la llave y el modo JSON, y devuelve texto y uso', async () => {
    let seen: any;
    const { f } = fakeFetch({ 'api.groq.com': (_u, init) => ((seen = { init, body: JSON.parse(init.body) }), ok('{"a":1}')) });
    const r = await callCandidate(A, { task: 'judge', prompt: 'hola', json: true }, ENV, f);
    expect(r).toEqual({ ok: true, text: '{"a":1}', usage: { prompt: 3, completion: 4 } });
    expect(seen.body.model).toBe('m-a');
    expect(seen.body.response_format).toEqual({ type: 'json_object' });
    expect(seen.init.headers.Authorization).toBe('Bearer g');
  });

  it('si el modelo no acepta el modo JSON, reintenta UNA vez sin el', async () => {
    const bodies: any[] = [];
    const { f } = fakeFetch({
      'api.groq.com': (_u, init) => {
        const b = JSON.parse(init.body);
        bodies.push(b);
        return b.response_format ? err(400, '{"error":{"message":"response_format is not supported for this model"}}') : ok('texto');
      },
    });
    const r = await callCandidate(A, { task: 'judge', prompt: 'x', json: true }, ENV, f);
    expect(r.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].response_format).toBeUndefined();
  });

  it('un proveedor sin modo JSON declarado no lo recibe', async () => {
    let body: any;
    const { f } = fakeFetch({ 'integrate.api.nvidia.com': (_u, init) => ((body = JSON.parse(init.body)), ok('x')) });
    await callCandidate({ provider: 'nvidia', model: 'm' }, { task: 'judge', prompt: 'x', json: true }, { NVIDIA_API_KEY: 'n' }, f);
    expect(body.response_format).toBeUndefined();
  });

  it('un fallo de red no lanza', async () => {
    const f = (async () => {
      throw new Error('red caida');
    }) as unknown as typeof fetch;
    expect(await callCandidate(A, { task: 'judge', prompt: 'x' }, ENV, f)).toEqual({ ok: false, kind: 'server' });
  });

  it('respuesta 200 sin texto = no utilizable', async () => {
    const { f } = fakeFetch({ 'api.groq.com': () => ok('   ') });
    expect(await callCandidate(A, { task: 'judge', prompt: 'x' }, ENV, f)).toEqual({ ok: false, kind: 'unparseable' });
  });
});

describe('routeText', () => {
  const opts = (extra: object = {}) => ({ task: 'judge' as const, prompt: 'p', chain: [A, B, C], ...extra });

  it('sin proveedores configurados no llama a nadie', async () => {
    const r = await routeText({ task: 'judge', prompt: 'p', deps: { env: {}, health: new HealthTracker() } });
    expect(r).toEqual({ ok: false, reason: 'no_providers', attempts: [] });
  });

  it('el primero responde: no se llama a los demas', async () => {
    const { f, calls } = fakeFetch({ 'api.groq.com': () => ok('uno'), 'api.cerebras.ai': () => ok('dos') });
    const r = await routeText({ ...opts(), deps: { env: ENV, fetchImpl: f, health: new HealthTracker() } });
    expect(r.ok && r.provider).toBe('groq');
    expect(calls).toEqual(['api.groq.com']);
  });

  it('el primero se cae (500): responde el segundo y queda registrado el intento', async () => {
    const { f } = fakeFetch({ 'api.groq.com': () => err(500), 'api.cerebras.ai': () => ok('dos') });
    const r = await routeText({ ...opts(), deps: { env: ENV, fetchImpl: f, health: new HealthTracker() } });
    expect(r.ok && r.provider).toBe('cerebras');
    expect(r.attempts.map((a) => [a.provider, a.ok, a.kind])).toEqual([
      ['groq', false, 'server'],
      ['cerebras', true, undefined],
    ]);
  });

  it('cuota diaria agotada: el siguiente enrutado ya NO vuelve a golpear al agotado', async () => {
    const h = new HealthTracker();
    const { f, calls } = fakeFetch({
      'api.groq.com': () => err(429, 'tokens per day (TPD) limit reached'),
      'api.cerebras.ai': () => ok('ok'),
    });
    await routeText({ ...opts(), deps: { env: ENV, fetchImpl: f, health: h } });
    calls.length = 0;
    const r2 = await routeText({ ...opts(), deps: { env: ENV, fetchImpl: f, health: h } });
    expect(r2.ok && r2.provider).toBe('cerebras');
    expect(calls).toEqual(['api.cerebras.ai']); // groq apartado hasta el reinicio
  });

  it('respuesta que no pasa la validacion: se prueba el siguiente', async () => {
    const { f } = fakeFetch({ 'api.groq.com': () => ok('basura'), 'api.cerebras.ai': () => ok('{"v":1}') });
    const r = await routeText<{ v: number }>({
      ...opts(),
      validate: (t) => {
        try {
          return { value: JSON.parse(t), quality: 1 };
        } catch {
          return null;
        }
      },
      deps: { env: ENV, fetchImpl: f, health: new HealthTracker() },
    });
    expect(r.ok && r.value).toEqual({ v: 1 });
    expect(r.attempts[0]).toMatchObject({ provider: 'groq', ok: false, kind: 'unparseable' });
  });

  it('calidad insuficiente: sigue buscando y devuelve la MEJOR vista (nunca peor que lo ya obtenido)', async () => {
    const { f } = fakeFetch({ 'api.groq.com': () => ok('7'), 'api.cerebras.ai': () => ok('4'), 'api.mistral.ai': () => ok('9') });
    const r = await routeText<number>({
      ...opts(),
      validate: (t) => ({ value: Number(t), quality: Number(t) / 10 }),
      acceptQuality: 0.95,
      deps: { env: ENV, fetchImpl: f, health: new HealthTracker() },
    });
    expect(r.ok && r.value).toBe(9);
    const r2 = await routeText<number>({
      ...opts(),
      chain: [A, B],
      validate: (t) => ({ value: Number(t), quality: Number(t) / 10 }),
      acceptQuality: 0.95,
      deps: { env: ENV, fetchImpl: f, health: new HealthTracker() },
    });
    expect(r2.ok && r2.value).toBe(7); // groq=7 y cerebras=4: gana el 7
  });

  it('exclude saca a un proveedor de la ruta', async () => {
    const { f, calls } = fakeFetch({ 'api.groq.com': () => ok('uno'), 'api.cerebras.ai': () => ok('dos') });
    const r = await routeText({ ...opts(), exclude: ['groq'], deps: { env: ENV, fetchImpl: f, health: new HealthTracker() } });
    expect(r.ok && r.provider).toBe('cerebras');
    expect(calls).not.toContain('api.groq.com');
  });

  it('todos fallan: exhausted, con el detalle; todos apartados: all_unavailable sin llamar a nadie', async () => {
    const h = new HealthTracker();
    const { f, calls } = fakeFetch({ 'api.groq.com': () => err(401), 'api.cerebras.ai': () => err(401), 'api.mistral.ai': () => err(401) });
    const r = await routeText({ ...opts(), deps: { env: ENV, fetchImpl: f, health: h } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('exhausted');
    expect(r.attempts).toHaveLength(3);
    calls.length = 0;
    const r2 = await routeText({ ...opts(), deps: { env: ENV, fetchImpl: f, health: h } });
    expect(!r2.ok && r2.reason).toBe('all_unavailable');
    expect(calls).toEqual([]);
  });

  it('maxAttempts limita cuantos candidatos se prueban', async () => {
    const { f, calls } = fakeFetch({ 'api.groq.com': () => err(500), 'api.cerebras.ai': () => err(500), 'api.mistral.ai': () => ok('x') });
    const r = await routeText({ ...opts(), maxAttempts: 2, deps: { env: ENV, fetchImpl: f, health: new HealthTracker() } });
    expect(r.ok).toBe(false);
    expect(calls).toEqual(['api.groq.com', 'api.cerebras.ai']);
  });
});
