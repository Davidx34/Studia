import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyGeminiHttp, fallbackModels, geminiGenerate, geminiHealthSnapshot, modelChain, probeGeminiModel, resetGeminiHealth, DEFAULT_FALLBACK_MODELS } from './geminiDirect';

const OK = (text = '{"ok":true}') => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 0 } }), { status: 200 });
const ERR = (status: number, body = '{}') => new Response(body, { status });
const DAILY = JSON.stringify({ error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
const NO_NEW_USERS = JSON.stringify({ error: { message: 'This model models/gemini-2.5-flash is no longer available to new users.' } });

type Reply = Response | (() => Response);
// fetch simulado: cada modelo tiene una lista de respuestas (se consumen en orden; la ultima se repite).
function mockFetch(byModel: Record<string, Reply[]>) {
  const calls: { model: string; body: any }[] = [];
  const counters: Record<string, number> = {};
  const fn = vi.fn(async (url: any, init: any) => {
    const model = /models\/([^:]+):/.exec(String(url))![1];
    calls.push({ model, body: JSON.parse(init.body) });
    const replies = byModel[model] ?? [ERR(404, NO_NEW_USERS)];
    const i = Math.min(counters[model] ?? 0, replies.length - 1);
    counters[model] = (counters[model] ?? 0) + 1;
    const r = replies[i];
    return typeof r === 'function' ? r() : r.clone();
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const base = { role: 'judge' as const, parts: [{ text: 'hola' }], apiKey: 'k', sleep: async () => {}, env: { GEMINI_MODEL_JUDGE: 'm1', GEMINI_MODEL_FALLBACKS: 'm2,m3' } as Record<string, string> };

beforeEach(() => {
  resetGeminiHealth();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('classifyGeminiHttp', () => {
  it('traduce cada respuesta a su causa', () => {
    expect(classifyGeminiHttp(429, DAILY)).toBe('quota_daily');
    expect(classifyGeminiHttp(429, '{"error":"rate"}')).toBe('rate_limited');
    expect(classifyGeminiHttp(404, NO_NEW_USERS)).toBe('model_unavailable');
    expect(classifyGeminiHttp(403, '')).toBe('model_unavailable');
    expect(classifyGeminiHttp(401, '')).toBe('auth');
    expect(classifyGeminiHttp(503, '')).toBe('server');
    expect(classifyGeminiHttp(500, '')).toBe('server');
    expect(classifyGeminiHttp(400, '')).toBe('bad_request');
    expect(classifyGeminiHttp(413, '')).toBe('bad_request');
  });
});

describe('modelChain', () => {
  it('lo configurado primero, luego el respaldo, sin repetir', () => {
    expect(modelChain('judge', { GEMINI_MODEL_JUDGE: 'a', GEMINI_MODEL_FALLBACKS: 'b,a,c' })).toEqual(['a', 'b', 'c']);
  });
  it('por defecto el respaldo son los modelos 3.x; `none` lo desactiva', () => {
    expect(fallbackModels({})).toEqual(DEFAULT_FALLBACK_MODELS);
    expect(fallbackModels({ GEMINI_MODEL_FALLBACKS: 'none' })).toEqual([]);
    expect(modelChain('judge', { GEMINI_MODEL_FALLBACKS: 'none' })).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
  });
  it('el caso real (2026-10-26/31): con una llave nueva los 2.5 dan 404, asi que NINGUNA cadena por defecto los pide', () => {
    for (const role of ['judge', 'pdf', 'chunks', 'topics'] as const) {
      const chain = modelChain(role, {});
      expect(chain.length, role).toBeGreaterThan(0);
      expect(chain.some((m) => /^gemini-2\.5/.test(m)), role).toBe(false);
    }
    expect(modelChain('pdf', {}).slice(0, 2)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash']);
  });
  it('un modelo 2.5 puesto A PROPOSITO por entorno se respeta (llaves antiguas aun lo tienen)', () => {
    expect(modelChain('judge', { GEMINI_MODEL_JUDGE: 'gemini-2.5-flash' })[0]).toBe('gemini-2.5-flash');
  });
});

describe('geminiGenerate', () => {
  it('sin llave: no_key, sin red', async () => {
    const m = mockFetch({});
    const r = await geminiGenerate({ ...base, apiKey: undefined, env: { ...base.env }, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: false, reason: 'no_key' });
    expect(m.fn).not.toHaveBeenCalled();
  });

  it('responde con el primer modelo y devuelve el uso en tokens', async () => {
    const m = mockFetch({ m1: [OK('hola')] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: true, text: 'hola', model: 'm1', usage: { prompt: 10, output: 5 } });
    expect(m.calls).toHaveLength(1);
  });

  it('404 en el primer modelo: usa el siguiente, lo recuerda y avisa UNA vez', async () => {
    const m = mockFetch({ m1: [ERR(404, NO_NEW_USERS)], m2: [OK('desde m2')] });
    const r1 = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r1).toMatchObject({ ok: true, text: 'desde m2', model: 'm2' });
    expect(m.calls.map((c) => c.model)).toEqual(['m1', 'm2']);

    const r2 = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r2).toMatchObject({ ok: true, model: 'm2' });
    expect(m.calls.map((c) => c.model)).toEqual(['m1', 'm2', 'm2']); // m1 ya no se pide
    expect(r2.attempts[0]).toMatchObject({ model: 'm1', kind: 'skipped' });

    const warns = (console.warn as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(warns.filter((w: string) => w.includes('m1 no esta disponible'))).toHaveLength(1);
  });

  it('un modelo descartado vuelve a probarse cuando pasa su tiempo', async () => {
    let t = 1_000_000;
    const m = mockFetch({ m1: [ERR(404), OK('ya volvio')], m2: [OK('m2')] });
    await geminiGenerate({ ...base, fetchImpl: m.fn, now: () => t });
    t += 7 * 3600_000; // pasan 7 horas (el TTL del 404 es de 6)
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn, now: () => t });
    expect(r).toMatchObject({ ok: true, model: 'm1', text: 'ya volvio' });
  });

  it('cuota diaria de un modelo (es POR MODELO): prueba otro', async () => {
    const m = mockFetch({ m1: [ERR(429, DAILY)], m2: [OK('m2')] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: true, model: 'm2' });
    expect(geminiHealthSnapshot().map((h) => h.model)).toContain('m1');
  });

  it('cuota diaria en TODOS los modelos: quota_daily', async () => {
    const m = mockFetch({ m1: [ERR(429, DAILY)], m2: [ERR(429, DAILY)], m3: [ERR(429, DAILY)] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: false, reason: 'quota_daily', status: 429 });
  });

  it('429 por minuto: reintenta con espera y luego pasa al siguiente modelo', async () => {
    const sleep = vi.fn(async () => {});
    const m = mockFetch({ m1: [ERR(429, '{"error":"rate"}')], m2: [OK('m2')] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn, sleep, retries: 2 });
    expect(r).toMatchObject({ ok: true, model: 'm2' });
    expect(m.calls.filter((c) => c.model === 'm1')).toHaveLength(3); // 1 + 2 reintentos
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('un 503 transitorio que se recupera en el reintento NO cambia de modelo', async () => {
    const m = mockFetch({ m1: [ERR(503), OK('recuperado')] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: true, model: 'm1', text: 'recuperado' });
  });

  it('los modelos de respaldo reintentan como maximo una vez', async () => {
    const m = mockFetch({ m1: [ERR(404)], m2: [ERR(503)], m3: [ERR(503)] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn, retries: 5 });
    expect(r.ok).toBe(false);
    expect(m.calls.filter((c) => c.model === 'm2')).toHaveLength(2);
    expect(m.calls.filter((c) => c.model === 'm3')).toHaveLength(2);
  });

  it('un error de red / timeout cuenta como fallo y se pasa al siguiente', async () => {
    const m = mockFetch({ m1: [() => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }], m2: [OK('m2')] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn, retries: 0 });
    expect(r).toMatchObject({ ok: true, model: 'm2' });
  });

  it('el ajuste de pensar que el modelo rechaza (400 thinking) se reintenta SIN el ajuste', async () => {
    const m = mockFetch({ 'gemini-2.5-flash': [ERR(400, '{"error":{"message":"Thinking budget is not supported"}}'), OK('sin pensar')] });
    const r = await geminiGenerate({ ...base, env: { GEMINI_MODEL_JUDGE: 'gemini-2.5-flash', GEMINI_MODEL_FALLBACKS: 'none' }, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: true, text: 'sin pensar' });
    expect(m.calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(m.calls[1].body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('aplica el ajuste de pensar que corresponde a cada modelo (3.5 Flash-Lite: ninguno)', async () => {
    const m = mockFetch({ 'gemini-3.5-flash-lite': [OK()] });
    await geminiGenerate({ ...base, env: { GEMINI_MODEL_JUDGE: 'gemini-3.5-flash-lite', GEMINI_MODEL_FALLBACKS: 'none' }, fetchImpl: m.fn });
    expect(m.calls[0].body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('thinking: default no envia ningun ajuste', async () => {
    const m = mockFetch({ 'gemini-2.5-flash': [OK()] });
    await geminiGenerate({ ...base, thinking: 'default', env: { GEMINI_MODEL_JUDGE: 'gemini-2.5-flash', GEMINI_MODEL_FALLBACKS: 'none' }, fetchImpl: m.fn });
    expect(m.calls[0].body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('respuesta vacia: se prueba otro modelo', async () => {
    const m = mockFetch({ m1: [OK('   ')], m2: [OK('lleno')] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: true, model: 'm2', text: 'lleno' });
  });

  it('401 (llave invalida): se detiene en seco, sin gastar mas modelos', async () => {
    const m = mockFetch({ m1: [ERR(401)], m2: [OK()] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: false, reason: 'auth' });
    expect(m.calls).toHaveLength(1);
  });

  it('una peticion invalida (400) se intenta con 2 modelos como maximo', async () => {
    const m = mockFetch({ m1: [ERR(400)], m2: [ERR(400)], m3: [OK()] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: false, reason: 'bad_request' });
    expect(m.calls.map((c) => c.model)).toEqual(['m1', 'm2']);
  });

  it('todos los modelos retirados: model_unavailable (no inventa texto)', async () => {
    const m = mockFetch({ m1: [ERR(404)], m2: [ERR(404)], m3: [ERR(404)] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: false, reason: 'model_unavailable' });
    expect('text' in r).toBe(false);
  });

  it('la causa que se reporta: lo transitorio gana a la cuota y a lo demas (se puede reintentar)', async () => {
    const m = mockFetch({ m1: [ERR(404)], m2: [ERR(429, DAILY)], m3: [ERR(503)] });
    const r = await geminiGenerate({ ...base, fetchImpl: m.fn });
    expect(r).toMatchObject({ ok: false, reason: 'server' });
  });

  it('el texto del lote y la llave van en la peticion; la llave no sale en el resultado', async () => {
    const m = mockFetch({ m1: [OK('x')] });
    const r = await geminiGenerate({ ...base, apiKey: 'SECRETA123', fetchImpl: m.fn });
    expect(JSON.stringify(r)).not.toContain('SECRETA123');
    expect(m.calls[0].body.contents[0].parts).toEqual([{ text: 'hola' }]);
  });
});

describe('probeGeminiModel (para ai:doctor)', () => {
  it('distingue un modelo que responde de uno que da 404', async () => {
    const m = mockFetch({ bueno: [OK()], viejo: [ERR(404, NO_NEW_USERS)] });
    expect(await probeGeminiModel('bueno', { GEMINI_API_KEY: 'k' }, m.fn)).toMatchObject({ ok: true, status: 200 });
    expect(await probeGeminiModel('viejo', { GEMINI_API_KEY: 'k' }, m.fn)).toMatchObject({ ok: false, status: 404, kind: 'model_unavailable' });
    expect(await probeGeminiModel('x', {}, m.fn)).toMatchObject({ ok: false, kind: 'no_key' });
  });
});
