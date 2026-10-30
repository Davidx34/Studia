import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { effectiveMaxTokens, reasoningEffortFor, HEADROOM, MAX_OUTPUT_CEILING } from './thinking';
import * as clientMod from './gateway/client';
import { callCandidate } from './gateway/client';
import { classifyFailure } from './gateway/failure';
import { buildCohereBody, callCohereCandidate, cohereCandidate, parseCohereResponse, COHERE_ENDPOINT, COHERE_MAX_OUTPUT_TOKENS } from './gateway/cohere';
import { PROVIDERS, chainWithCohere, isProviderConfigured, providerById } from './gateway/providers';
import { HealthTracker } from './gateway/health';
import { routeText, retryDelayMs, RETRY_BASE_DELAY_MS } from './gateway/router';
import { sharedHealth } from './gateway/health';
import {
  PERSISTABLE_KINDS,
  SYNC_TTL_MS,
  createSupabaseHealthStore,
  defaultHealthStore,
  persistBlock,
  persistenceEnabled,
  resetDefaultHealthStoreForTests,
  shouldPersist,
  syncPersistedHealth,
  type HealthDb,
  type HealthStore,
  type PersistedBlock,
} from './gateway/persist';
import { embedTexts } from '@/lib/embeddings/router';
import { embedChain } from '@/lib/embeddings/providers';
import { callCohere, hasGenerationProvider } from '@/lib/questions/cohereGeneration';
import { callStudyModel, hasStudyProvider } from '@/lib/study/generate';
import { parseConcepts } from '@/lib/questions/conceptTaxonomy';
import {
  cellsInLine,
  checkTableOrientation,
  extractMarkdownTables,
  normalizeCell,
  tableOrientation,
  FIT_MIN,
} from '@/lib/materials/tableCheck';
import { verifyPage } from '@/lib/materials/pdfVerify';
import { convertPdfToMarkdown } from '@/lib/materials/pdfToMarkdown';
import type { PageData } from '@/lib/materials/pdfExtract';
import type { PdfVisionCall } from '@/lib/ai/geminiPdf';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const HOUR = 3_600_000;

const chatOk = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const cohereOk = (text: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ message: { content: [{ type: 'text', text }] }, ...extra }), { status: 200 });

// ───────────────────────────── 1. politica de pensamiento ─────────────────────────────
describe('thinking.ts: nivel de razonamiento y margen de salida', () => {
  it('gpt-oss en Groq/Cerebras: medio al generar y estudiar, bajo al juzgar y analizar', () => {
    for (const prov of ['groq', 'cerebras']) {
      expect(reasoningEffortFor(prov, 'openai/gpt-oss-120b', 'generation')).toBe('medium');
      expect(reasoningEffortFor(prov, 'openai/gpt-oss-120b', 'study')).toBe('medium');
      expect(reasoningEffortFor(prov, 'openai/gpt-oss-20b', 'judge')).toBe('low');
      expect(reasoningEffortFor(prov, 'gpt-oss-120b', 'analysis')).toBe('low');
    }
  });
  it('Gemini 3.x: bajo (los tokens ocultos dejaban sin preguntas un modulo con minijuegos); los 2.5 y otros proveedores: nada', () => {
    expect(reasoningEffortFor('gemini', 'gemini-3.5-flash-lite', 'generation')).toBe('low');
    expect(reasoningEffortFor('gemini', 'gemini-3.8-flash', 'judge')).toBe('low');
    expect(reasoningEffortFor('gemini', 'gemini-2.5-flash', 'generation')).toBeNull();
    expect(reasoningEffortFor('mistral', 'gpt-oss-120b', 'generation')).toBeNull();
    expect(reasoningEffortFor('groq', 'qwen/qwen3.8-27b', 'generation')).toBeNull();
    expect(reasoningEffortFor('cohere', 'c4ai-aya-expanse-32b', 'study')).toBeNull();
  });
  it('effectiveMaxTokens: sin razonamiento no cambia; con razonamiento suma el margen; nunca pasa del techo', () => {
    // Valores literales a proposito: comparar contra la propia constante no detectaria que alguien la cambie.
    expect(HEADROOM).toEqual({ low: 1024, medium: 2048 });
    expect(effectiveMaxTokens(4096, 'low')).toBe(5120);
    expect(effectiveMaxTokens(4096, 'medium')).toBe(6144);
    expect(effectiveMaxTokens(4096, null)).toBe(4096);
    expect(effectiveMaxTokens(4096, 'low')).toBe(4096 + HEADROOM.low);
    expect(effectiveMaxTokens(4096, 'medium')).toBe(4096 + HEADROOM.medium);
    expect(effectiveMaxTokens(MAX_OUTPUT_CEILING - 10, 'medium')).toBe(MAX_OUTPUT_CEILING);
    // Si ya piden mas que el techo, no se les RECORTA (no es asunto de este calculo): se queda como lo pidieron.
    expect(effectiveMaxTokens(MAX_OUTPUT_CEILING + 5000, 'medium')).toBe(MAX_OUTPUT_CEILING + 5000);
  });
  it('effectiveMaxTokens ante valores raros', () => {
    expect(effectiveMaxTokens(Number.NaN, null)).toBe(1);
    expect(effectiveMaxTokens(-5, 'low')).toBe(1 + HEADROOM.low);
    expect(effectiveMaxTokens(Infinity, null)).toBe(1);
    expect(effectiveMaxTokens(10.9, null)).toBe(10);
  });
  it('el cliente de la pasarela usa ESTA politica (misma funcion, no una copia)', () => {
    expect(clientMod.reasoningEffortFor).toBe(reasoningEffortFor);
    expect(read('src/lib/ai/gateway/client.ts')).not.toMatch(/function reasoningEffortFor/);
  });
  it('en la peticion real a Groq con gpt-oss, max_tokens lleva el margen; en un modelo sin razonamiento, no', async () => {
    const f = vi.fn(async () => chatOk('x'));
    await callCandidate({ provider: 'groq', model: 'openai/gpt-oss-120b' }, { task: 'generation', prompt: 'p', maxTokens: 4000 }, { GROQ_API_KEY: 'k' }, f as any);
    const body1 = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(body1.reasoning_effort).toBe('medium');
    expect(body1.max_tokens).toBe(4000 + HEADROOM.medium);

    await callCandidate({ provider: 'groq', model: 'qwen/qwen3.8-27b' }, { task: 'generation', prompt: 'p', maxTokens: 4000 }, { GROQ_API_KEY: 'k' }, f as any);
    const body2 = JSON.parse((f.mock.calls[1] as any)[1].body);
    expect(body2.reasoning_effort).toBeUndefined();
    expect(body2.max_tokens).toBe(4000);
  });
  it('si el proveedor rechaza reasoning_effort (400), el reintento sin el parametro vuelve al tope pedido', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('unsupported reasoning parameter', { status: 400 }))
      .mockResolvedValueOnce(chatOk('ok'));
    const r = await callCandidate({ provider: 'groq', model: 'openai/gpt-oss-120b' }, { task: 'judge', prompt: 'p', maxTokens: 1000 }, { GROQ_API_KEY: 'k' }, f as any);
    expect(r.ok).toBe(true);
    const retryBody = JSON.parse((f.mock.calls[1] as any)[1].body);
    expect(retryBody.reasoning_effort).toBeUndefined();
    expect(retryBody.max_tokens).toBe(1000);
  });
});

// ───────────────────────────── 2. Cohere como proveedor de la pasarela ─────────────────────────────
describe('Cohere: adaptador', () => {
  it('buildCohereBody: tope de 4096, system aparte, temperatura solo si la piden', () => {
    expect(buildCohereBody('m', { task: 'study', prompt: 'hola' })).toEqual({ model: 'm', messages: [{ role: 'user', content: 'hola' }], max_tokens: COHERE_MAX_OUTPUT_TOKENS });
    const b: any = buildCohereBody('m', { task: 'study', prompt: 'hola', system: 'sys', maxTokens: 6000, temperature: 0.3 });
    expect(b.max_tokens).toBe(4096);
    expect(b.temperature).toBe(0.3);
    expect(b.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect((buildCohereBody('m', { task: 'study', prompt: 'x', maxTokens: 1500 }) as any).max_tokens).toBe(1500);
    expect('temperature' in buildCohereBody('m', { task: 'study', prompt: 'x', temperature: 0 })).toBe(true);
  });
  it('parseCohereResponse: une los trozos de texto, ignora los que no son texto, detecta truncado y lee el uso', () => {
    const p = parseCohereResponse({ message: { content: [{ type: 'text', text: 'ab' }, { type: 'thinking' }, { type: 'text', text: 'cd' }] }, finish_reason: 'MAX_TOKENS', usage: { tokens: { input_tokens: 7, output_tokens: 9 } } });
    expect(p).toEqual({ text: 'abcd', truncated: true, usage: { prompt: 7, completion: 9 } });
    expect(parseCohereResponse({ message: { content: [{ text: '   ' }] } })).toBeNull();
    expect(parseCohereResponse({ message: { content: 'no es lista' } })).toBeNull();
    expect(parseCohereResponse({})).toBeNull();
    expect(parseCohereResponse(null)).toBeNull();
    expect(parseCohereResponse({ message: { content: [{ text: 'x' }] }, finish_reason: 'COMPLETE' })?.truncated).toBe(false);
  });
  it('callCohereCandidate: manda la peticion con la llave en la cabecera y devuelve el texto', async () => {
    const f = vi.fn(async () => cohereOk('hola', { usage: { tokens: { input_tokens: 1, output_tokens: 2 } } }));
    const r = await callCohereCandidate(cohereCandidate({}), { task: 'study', prompt: 'p' }, { COHERE_API_KEY: 'sk-secreta' }, f as any);
    expect(r).toEqual({ ok: true, text: 'hola', usage: { prompt: 1, completion: 2 } });
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe(COHERE_ENDPOINT);
    expect(init.headers.Authorization).toBe('Bearer sk-secreta');
    expect(JSON.parse(init.body).model).toBe('c4ai-aya-expanse-32b');
  });
  it('clasifica los fallos: 401 auth, 402 payment, 429 por minuto, 429 mensual = cuota larga, 5xx server, red caida, tiempo agotado, vacio', async () => {
    const run = async (res: Response | Error) =>
      callCohereCandidate(cohereCandidate({}), { task: 'study', prompt: 'p' }, { COHERE_API_KEY: 'k' }, (async () => {
        if (res instanceof Error) throw res;
        return res;
      }) as any);
    expect(await run(new Response('{"message":"invalid api token"}', { status: 401 }))).toMatchObject({ ok: false, kind: 'auth', status: 401 });
    expect(await run(new Response('x', { status: 402 }))).toMatchObject({ kind: 'payment' });
    expect(await run(new Response('{"message":"limited to 20 API calls / minute"}', { status: 429, headers: { 'retry-after': '12' } }))).toMatchObject({ kind: 'rate_minute', retryAfterMs: 12000 });
    expect(await run(new Response('{"message":"You are using a Trial key, which is limited to 1000 API calls / month."}', { status: 429 }))).toMatchObject({ kind: 'rate_daily' });
    expect(await run(new Response('boom', { status: 503 }))).toMatchObject({ kind: 'server' });
    expect(await run(new TypeError('fetch failed'))).toEqual({ ok: false, kind: 'server' });
    expect(await run(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toEqual({ ok: false, kind: 'timeout' });
    expect(await run(cohereOk('   '))).toEqual({ ok: false, kind: 'unparseable' });
  });
  it('sin llave: auth, y NO se hace ninguna peticion', async () => {
    const f = vi.fn();
    expect(await callCohereCandidate(cohereCandidate({}), { task: 'study', prompt: 'p' }, {}, f as any)).toEqual({ ok: false, kind: 'auth' });
    expect(f).not.toHaveBeenCalled();
  });
  it('SEGURIDAD: el mensaje de error no repite credenciales largas', async () => {
    const key = 'k'.repeat(40);
    const r: any = await callCohereCandidate(cohereCandidate({}), { task: 'study', prompt: 'p' }, { COHERE_API_KEY: key }, (async () => new Response(`{"message":"bad token ${key}"}`, { status: 401 })) as any);
    expect(r.message).not.toContain(key);
  });
  it('classifyFailure: el tope mensual es cuota larga; el limite por minuto, no; lo diario de siempre sigue igual', () => {
    expect(classifyFailure(429, 'limited to 1000 API calls / month').kind).toBe('rate_daily');
    expect(classifyFailure(429, 'monthly quota').kind).toBe('rate_daily');
    expect(classifyFailure(429, 'limited to 20 API calls / minute').kind).toBe('rate_minute');
    expect(classifyFailure(429, 'Requests per day limit').kind).toBe('rate_daily');
    expect(classifyFailure(429, 'x', '7200').kind).toBe('rate_daily');
  });
  it('COHERE_MODEL cambia el modelo sin tocar codigo', () => {
    expect(cohereCandidate({}).model).toBe('c4ai-aya-expanse-32b');
    expect(cohereCandidate({ COHERE_MODEL: ' command-a-03-2025 ' }).model).toBe('command-a-03-2025');
    expect(cohereCandidate({ COHERE_MODEL: '   ' }).model).toBe('c4ai-aya-expanse-32b');
  });
  it('esta en el catalogo, con adaptador propio, y se activa solo con su llave', () => {
    const p = providerById('cohere')!;
    expect(p).toBeDefined();
    expect(p.custom).toBe(true);
    expect(PROVIDERS.filter((x) => x.id === 'cohere')).toHaveLength(1);
    expect(isProviderConfigured(p, {})).toBe(false);
    expect(isProviderConfigured(p, { COHERE_API_KEY: 'k' })).toBe(true);
  });
  it('callCandidate lo enruta a su adaptador (nunca al cliente generico de OpenAI)', async () => {
    const f = vi.fn(async () => cohereOk('ok'));
    const r = await callCandidate({ provider: 'cohere', model: 'm' }, { task: 'study', prompt: 'p' }, { COHERE_API_KEY: 'k' }, f as any);
    expect(r).toMatchObject({ ok: true, text: 'ok' });
    expect((f.mock.calls[0] as any)[0]).toBe('https://api.cohere.com/v2/chat');
  });
});

describe('chainWithCohere', () => {
  const env = { COHERE_API_KEY: 'c', GROQ_API_KEY: 'g', CEREBRAS_API_KEY: 'x' };
  it('lo pone primero o ultimo, solo si hay llave', () => {
    const first = chainWithCohere('study', 'first', env);
    const last = chainWithCohere('study', 'last', env);
    expect(first[0]).toEqual({ provider: 'cohere', model: 'c4ai-aya-expanse-32b' });
    expect(last[last.length - 1].provider).toBe('cohere');
    expect(first.slice(1)).toEqual(last.slice(0, -1));
    expect(chainWithCohere('study', 'first', { GROQ_API_KEY: 'g' }).some((c) => c.provider === 'cohere')).toBe(false);
  });
  it('si el entorno YA lo puso en la cadena, se respeta su lugar', () => {
    const e = { ...env, AI_CHAIN_STUDY: 'groq:openai/gpt-oss-120b,cohere:c4ai-aya-expanse-32b' };
    const c = chainWithCohere('study', 'first', e);
    expect(c.map((x) => x.provider)).toEqual(['groq', 'cohere']);
  });
  it('sin ninguna llave la cadena queda vacia', () => {
    expect(chainWithCohere('generation', 'first', {})).toEqual([]);
  });
});

// ───────────────────────────── 3. reintentos por candidato en routeText ─────────────────────────────
describe('routeText: attemptsPerCandidate', () => {
  const env = { COHERE_API_KEY: 'c', GROQ_API_KEY: 'g' };
  const cohere = { provider: 'cohere', model: 'c4ai-aya-expanse-32b' };
  const groq = { provider: 'groq', model: 'qwen/qwen3.8-27b' };
  const mk = () => ({ health: new HealthTracker(), sleep: vi.fn(async (_ms: number) => {}), healthStore: null });

  it('la espera crece: 1,5 s, 3 s, 6 s', () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([RETRY_BASE_DELAY_MS, RETRY_BASE_DELAY_MS * 2, RETRY_BASE_DELAY_MS * 4]);
  });
  it('un 5xx pasajero se reintenta con espera y la segunda vez responde', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('x', { status: 500 })).mockResolvedValueOnce(cohereOk('listo'));
    const d = mk();
    const r = await routeText({ task: 'study', prompt: 'p', chain: [cohere], attemptsPerCandidate: 3, deps: { env, fetchImpl: f as any, ...d } });
    expect(r.ok && r.value).toBe('listo');
    expect(f).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledTimes(1);
    expect(d.sleep).toHaveBeenCalledWith(retryDelayMs(1));
  });
  it('con 3 intentos y 3 fallos seguidos llama 3 veces: el cortacircuito que se abre al 2.o no corta los reintentos del MISMO candidato', async () => {
    const f = vi.fn(async () => new Response('x', { status: 500 }));
    const d = mk();
    const r = await routeText({ task: 'study', prompt: 'p', chain: [cohere], attemptsPerCandidate: 3, deps: { env, fetchImpl: f as any, ...d } });
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(3);
    expect(d.sleep.mock.calls.map((c) => c[0])).toEqual([retryDelayMs(1), retryDelayMs(2)]);
    // ...pero la SIGUIENTE llamada ya lo encuentra apartado.
    const again = await routeText({ task: 'study', prompt: 'p', chain: [cohere], attemptsPerCandidate: 3, deps: { env, fetchImpl: f as any, ...d } });
    expect(again).toMatchObject({ ok: false, reason: 'all_unavailable' });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('fallos que reintentar no arregla (llave, cuota diaria, modelo inexistente, peticion mala) pasan DE INMEDIATO al siguiente', async () => {
    for (const status of [401, 402, 404, 400]) {
      const f = vi.fn(async (url: any) => (String(url).includes('cohere') ? new Response('x', { status }) : chatOk('del-respaldo')));
      const d = mk();
      const r = await routeText({ task: 'study', prompt: 'p', chain: [cohere, groq], attemptsPerCandidate: 3, deps: { env, fetchImpl: f as any, ...d } });
      expect(r.ok && r.value).toBe('del-respaldo');
      expect(f.mock.calls.filter((c: any) => String(c[0]).includes('cohere'))).toHaveLength(1);
      expect(d.sleep).not.toHaveBeenCalled();
    }
    const f = vi.fn(async (url: any) => (String(url).includes('cohere') ? new Response('Requests per day', { status: 429 }) : chatOk('del-respaldo')));
    const r = await routeText({ task: 'study', prompt: 'p', chain: [cohere, groq], attemptsPerCandidate: 3, deps: { env, fetchImpl: f as any, ...mk() } });
    expect(r.ok && r.provider).toBe('groq');
    expect(f.mock.calls.filter((c: any) => String(c[0]).includes('cohere'))).toHaveLength(1);
  });
  it('una respuesta de calidad baja se reintenta en el mismo candidato y se conserva la mejor de todas', async () => {
    const qs = (n: number) => cohereOk(String(n));
    const f = vi.fn().mockResolvedValueOnce(qs(3)).mockResolvedValueOnce(qs(6)).mockResolvedValueOnce(qs(5));
    const r = await routeText<number>({
      task: 'generation', prompt: 'p', chain: [cohere], attemptsPerCandidate: 3, acceptQuality: 0.7,
      validate: (t) => ({ value: Number(t), quality: Number(t) / 10 }), deps: { env, fetchImpl: f as any, ...mk() },
    });
    expect(f).toHaveBeenCalledTimes(3);
    expect(r.ok && r.value).toBe(6);
  });
  it('una respuesta que ya alcanza la calidad pedida corta los reintentos', async () => {
    const f = vi.fn(async () => cohereOk('9'));
    const r = await routeText<number>({
      task: 'generation', prompt: 'p', chain: [cohere, groq], attemptsPerCandidate: 3, acceptQuality: 0.7,
      validate: (t) => ({ value: Number(t), quality: Number(t) / 10 }), deps: { env, fetchImpl: f as any, ...mk() },
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.ok && r.provider).toBe('cohere');
  });
  it('una respuesta ilegible (validate = null) se reintenta; si nunca sirve, se pasa al siguiente', async () => {
    const f = vi.fn(async (url: any) => (String(url).includes('cohere') ? cohereOk('basura') : chatOk('{"ok":1}')));
    const r = await routeText<any>({
      task: 'analysis', prompt: 'p', chain: [cohere, groq], attemptsPerCandidate: (c) => (c.provider === 'cohere' ? 2 : 1),
      validate: (t) => { try { return { value: JSON.parse(t), quality: 1 }; } catch { return null; } }, deps: { env, fetchImpl: f as any, ...mk() },
    });
    expect(f.mock.calls.filter((c: any) => String(c[0]).includes('cohere'))).toHaveLength(2);
    expect(r.ok && r.provider).toBe('groq');
  });
  it('sin la opcion, el comportamiento es el de siempre: un intento por candidato y sin esperas', async () => {
    const f = vi.fn(async () => new Response('x', { status: 500 }));
    const d = mk();
    await routeText({ task: 'study', prompt: 'p', chain: [cohere], deps: { env, fetchImpl: f as any, ...d } });
    expect(f).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
  });
  it('un valor absurdo (0, negativo, 2.7) se trata como al menos 1 intento entero', async () => {
    for (const [n, calls] of [[0, 1], [-4, 1], [2.7, 2]] as const) {
      const f = vi.fn(async () => new Response('x', { status: 500 }));
      await routeText({ task: 'study', prompt: 'p', chain: [cohere], attemptsPerCandidate: n, deps: { env, fetchImpl: f as any, ...mk() } });
      expect(f).toHaveBeenCalledTimes(calls);
    }
  });
});

// ───────────────────────────── 4. salud persistente ─────────────────────────────
describe('HealthTracker: failure() y hydrate()', () => {
  const c = { provider: 'groq', model: 'm' };
  it('failure devuelve cuanto aparto: cuota diaria hasta el reinicio (tope 8 h); un 5xx suelto, nada; bad_request, nada', () => {
    let t = Date.UTC(2026, 9, 30, 20, 0, 0);
    const h = new HealthTracker(() => t);
    const daily = h.failure(c, 'rate_daily');
    expect(daily.openMs).toBe(4 * HOUR); // 20:00 -> 00:00 UTC
    expect(daily.openUntil).toBe(t + 4 * HOUR);
    expect(h.failure({ provider: 'x', model: 'y' }, 'server').openMs).toBe(0);
    expect(h.failure({ provider: 'x', model: 'z' }, 'bad_request')).toMatchObject({ openMs: 0 });
    t += 1;
  });
  it('hydrate solo ALARGA: no acorta un bloqueo local, ignora vencidos y valores raros, y cuenta lo aplicado', () => {
    const t = 1_000_000;
    const h = new HealthTracker(() => t);
    h.failure(c, 'payment'); // 1 h local
    const local = h.get('groq:m').openUntil;
    expect(h.hydrate([{ key: 'groq:m', openUntil: t + 60_000 }])).toBe(0); // menor: no acorta
    expect(h.get('groq:m').openUntil).toBe(local);
    expect(h.hydrate([{ key: 'groq:m', openUntil: local + 5000 }])).toBe(1);
    expect(h.get('groq:m').openUntil).toBe(local + 5000);
    expect(h.hydrate([{ key: 'a:b', openUntil: t - 1 }, { key: 'a:b', openUntil: t }, { key: 'a:b', openUntil: Number.NaN }, { key: 'a:b', openUntil: Infinity }])).toBe(0);
    expect(h.isAvailable({ provider: 'a', model: 'b' })).toBe(true);
    expect(h.hydrate([{ key: 'n:m', openUntil: t + 1 }])).toBe(1);
    expect(h.isAvailable({ provider: 'n', model: 'm' })).toBe(false);
  });
});

describe('persist.ts: reglas', () => {
  it('solo se persisten las causas LARGAS y solo si de verdad aparto al candidato', () => {
    expect(Array.from(PERSISTABLE_KINDS).sort()).toEqual(['auth', 'not_found', 'payment', 'rate_daily']);
    expect(shouldPersist('rate_daily', 1)).toBe(true);
    expect(shouldPersist('rate_daily', 0)).toBe(false);
    for (const k of ['rate_minute', 'server', 'timeout', 'unparseable', 'bad_request'] as const) expect(shouldPersist(k, 99 * HOUR)).toBe(false);
  });
  it('es opt-in: solo AI_HEALTH_PERSIST=1', () => {
    expect(persistenceEnabled({})).toBe(false);
    expect(persistenceEnabled({ AI_HEALTH_PERSIST: '0' })).toBe(false);
    expect(persistenceEnabled({ AI_HEALTH_PERSIST: 'true' })).toBe(false);
    expect(persistenceEnabled({ AI_HEALTH_PERSIST: ' 1 ' })).toBe(true);
  });
  it('defaultHealthStore: apagado por defecto y sin llave de servicio; nunca toca la base si no hay con que', async () => {
    resetDefaultHealthStoreForTests();
    expect(await defaultHealthStore({})).toBeNull();
    expect(await defaultHealthStore({ AI_HEALTH_PERSIST: '1' })).toBeNull();
    expect(await defaultHealthStore({ AI_HEALTH_PERSIST: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://x' })).toBeNull();
    expect(await defaultHealthStore({ SUPABASE_SERVICE_ROLE_KEY: 'k', NEXT_PUBLIC_SUPABASE_URL: 'http://x' })).toBeNull();
  });
  it('syncPersistedHealth: aplica los vigentes, lee a lo sumo una vez por SYNC_TTL_MS y nunca lanza', async () => {
    const t0 = 5_000_000;
    const h = new HealthTracker(() => t0);
    const load = vi.fn(async (): Promise<PersistedBlock[]> => [{ key: 'groq:m', kind: 'rate_daily', openUntil: t0 + HOUR }]);
    const store: HealthStore = { load, save: vi.fn() };
    expect(await syncPersistedHealth(h, store, t0)).toBe(1);
    expect(h.isAvailable({ provider: 'groq', model: 'm' })).toBe(false);
    expect(await syncPersistedHealth(h, store, t0 + SYNC_TTL_MS - 1)).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
    await syncPersistedHealth(h, store, t0 + SYNC_TTL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    const broken: HealthStore = { load: async () => { throw new Error('sin tabla'); }, save: vi.fn() };
    await expect(syncPersistedHealth(h, broken, t0)).resolves.toBe(0);
    expect(await syncPersistedHealth(h, null, t0)).toBe(0);
  });
  it('syncPersistedHealth: llamadas simultaneas hacen UNA sola lectura', async () => {
    const h = new HealthTracker(() => 1);
    const load = vi.fn(async (): Promise<PersistedBlock[]> => []);
    const store: HealthStore = { load, save: vi.fn() };
    await Promise.all([syncPersistedHealth(h, store, 1), syncPersistedHealth(h, store, 1), syncPersistedHealth(h, store, 1)]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('persistBlock: guarda lo persistible, descarta el resto y no lanza ni espera mas de la cuenta', async () => {
    const save = vi.fn(async (_b: PersistedBlock) => {});
    const store: HealthStore = { load: async () => [], save };
    const b: PersistedBlock = { key: 'groq:m', kind: 'rate_daily', openUntil: 9 };
    expect(await persistBlock(store, b, HOUR)).toBe(true);
    expect(save).toHaveBeenCalledWith(b);
    expect(await persistBlock(store, { ...b, kind: 'rate_minute' }, HOUR)).toBe(false);
    expect(await persistBlock(store, b, 0)).toBe(false);
    expect(await persistBlock(null, b, HOUR)).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await persistBlock({ load: async () => [], save: async () => { throw new Error('base caida'); } }, b, HOUR)).toBe(false);
  });
  it('persistBlock: una escritura colgada se abandona (no retrasa la respuesta al usuario)', async () => {
    vi.useFakeTimers();
    try {
      const store: HealthStore = { load: async () => [], save: () => new Promise(() => {}) };
      const p = persistBlock(store, { key: 'a:b', kind: 'auth', openUntil: 1 }, HOUR);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await p).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('persist.ts: almacen de Postgres (cliente simulado)', () => {
  function fakeDb(rows: any[] = [], err: { message?: string } | null = null) {
    const calls: { op: string; args: any[] }[] = [];
    const db: HealthDb = {
      from: () => ({
        select: (cols: string) => ({ gt: (col: string, v: string) => { calls.push({ op: 'select', args: [cols, col, v] }); return Promise.resolve({ data: err ? null : rows, error: err }); } }),
        upsert: (row, opts) => { calls.push({ op: 'upsert', args: [row, opts] }); return Promise.resolve({ error: err }); },
        delete: () => ({ lt: (col: string, v: string) => { calls.push({ op: 'delete', args: [col, v] }); return Promise.resolve({ error: null }); } }),
      }),
    };
    return { db, calls };
  }
  it('load: pide solo los vigentes y descarta filas con causa o clave invalidas', async () => {
    const t = Date.UTC(2026, 9, 30, 12);
    const { db, calls } = fakeDb([
      { key: 'groq:m', kind: 'rate_daily', open_until: new Date(t + HOUR).toISOString() },
      { key: 'groq:m2', kind: 'server', open_until: new Date(t + HOUR).toISOString() },
      { key: 7, kind: 'auth', open_until: new Date(t + HOUR).toISOString() },
      { key: 'x:y', kind: 'auth', open_until: 'no es fecha' },
    ]);
    const blocks = await createSupabaseHealthStore(db).load(t);
    expect(blocks).toEqual([{ key: 'groq:m', kind: 'rate_daily', openUntil: t + HOUR }]);
    expect(calls[0].args).toEqual(['key, kind, open_until', 'open_until', new Date(t).toISOString()]);
  });
  it('load: un error de la base se propaga (syncPersistedHealth lo absorbe)', async () => {
    await expect(createSupabaseHealthStore(fakeDb([], { message: 'relation does not exist' }).db).load(1)).rejects.toThrow('relation does not exist');
  });
  it('save: upsert por clave y limpieza de lo vencido hace mas de un dia', async () => {
    const now = Date.UTC(2026, 9, 30, 12);
    const { db, calls } = fakeDb();
    await createSupabaseHealthStore(db, () => now).save({ key: 'groq:m', kind: 'rate_daily', openUntil: now + HOUR });
    expect(calls[0]).toEqual({ op: 'upsert', args: [{ key: 'groq:m', kind: 'rate_daily', open_until: new Date(now + HOUR).toISOString(), updated_at: new Date(now).toISOString() }, { onConflict: 'key' }] });
    expect(calls[1]).toEqual({ op: 'delete', args: ['open_until', new Date(now - 86_400_000).toISOString()] });
  });
  it('save: si el upsert falla se propaga y NO se intenta limpiar', async () => {
    const { db, calls } = fakeDb([], { message: 'denegado' });
    await expect(createSupabaseHealthStore(db).save({ key: 'a:b', kind: 'auth', openUntil: 1 })).rejects.toThrow('denegado');
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });
});

describe('routeText con salud persistente: un arranque en frio ya sabe que la cuota diaria se agoto', () => {
  const env = { GROQ_API_KEY: 'g', CEREBRAS_API_KEY: 'c' };
  const groq = { provider: 'groq', model: 'qwen/qwen3.8-27b' };
  const cerebras = { provider: 'cerebras', model: 'gpt-oss-120b' };

  it('instancia nueva + bloqueo guardado: NO se llama al proveedor agotado', async () => {
    const t = 10_000_000;
    const store: HealthStore = { load: async () => [{ key: 'groq:qwen/qwen3.8-27b', kind: 'rate_daily', openUntil: t + 2 * HOUR }], save: vi.fn() };
    const f = vi.fn(async (url: any) => chatOk(String(url).includes('groq') ? 'de-groq' : 'de-cerebras'));
    const r = await routeText({ task: 'generation', prompt: 'p', chain: [groq, cerebras], deps: { env, fetchImpl: f as any, health: new HealthTracker(() => t), now: () => t, healthStore: store } });
    expect(r.ok && r.value).toBe('de-cerebras');
    expect(f.mock.calls.every((c: any) => !String(c[0]).includes('groq'))).toBe(true);
  });
  it('sin almacen (apagado) se llama igual que siempre', async () => {
    const f = vi.fn(async () => chatOk('x'));
    const r = await routeText({ task: 'generation', prompt: 'p', chain: [groq, cerebras], deps: { env, fetchImpl: f as any, health: new HealthTracker(), healthStore: null } });
    expect(r.ok && r.provider).toBe('groq');
  });
  it('una cuota diaria agotada se GUARDA; un 429 por minuto o un 5xx, no', async () => {
    const save = vi.fn(async (_b: PersistedBlock) => {});
    const store: HealthStore = { load: async () => [], save };
    const run = (res: Response) => routeText({ task: 'generation', prompt: 'p', chain: [groq], deps: { env, fetchImpl: (async () => res) as any, health: new HealthTracker(), healthStore: store } });
    await run(new Response('Requests per day exceeded', { status: 429 }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ key: 'groq:qwen/qwen3.8-27b', kind: 'rate_daily' });
    expect((save.mock.calls[0][0] as PersistedBlock).openUntil).toBeGreaterThan(Date.now());
    await run(new Response('too many', { status: 429, headers: { 'retry-after': '5' } }));
    await run(new Response('boom', { status: 500 }));
    await run(new Response('boom', { status: 500 }));
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('una llave invalida (401) y un modelo inexistente (404) tambien se guardan', async () => {
    for (const [status, kind] of [[401, 'auth'], [404, 'not_found'], [402, 'payment']] as const) {
      const save = vi.fn(async (_b: PersistedBlock) => {});
      await routeText({ task: 'generation', prompt: 'p', chain: [groq], deps: { env, fetchImpl: (async () => new Response('x', { status })) as any, health: new HealthTracker(), healthStore: { load: async () => [], save } } });
      expect(save.mock.calls[0]?.[0]).toMatchObject({ kind });
    }
  });
  it('si la base falla (leer o escribir), la llamada de IA sigue funcionando', async () => {
    const store: HealthStore = { load: async () => { throw new Error('caida'); }, save: async () => { throw new Error('caida'); } };
    const ok = await routeText({ task: 'generation', prompt: 'p', chain: [groq], deps: { env, fetchImpl: (async () => chatOk('bien')) as any, health: new HealthTracker(), healthStore: store } });
    expect(ok.ok && ok.value).toBe('bien');
    const bad = await routeText({ task: 'generation', prompt: 'p', chain: [groq, cerebras], deps: { env, fetchImpl: (async (u: any) => (String(u).includes('groq') ? new Response('x', { status: 401 }) : chatOk('respaldo'))) as any, health: new HealthTracker(), healthStore: store } });
    expect(bad.ok && bad.value).toBe('respaldo');
  });
});

describe('embeddings: tambien comparten el bloqueo largo', () => {
  it('con la cuota diaria del unico proveedor guardada, no se hace ninguna peticion de embeddings', async () => {
    const env = { GEMINI_API_KEY: 'k' };
    const p = embedChain(env)[0];
    expect(p).toBeDefined();
    const t = 7_000_000;
    const store: HealthStore = { load: async () => [{ key: `embed:${p.id}:${p.profile}`, kind: 'rate_daily', openUntil: t + HOUR }], save: vi.fn() };
    const f = vi.fn();
    const r = await embedTexts(['hola'], 'document', { deps: { env, fetchImpl: f as any, health: new HealthTracker(() => t), now: () => t, healthStore: store } });
    expect(r).toMatchObject({ ok: false, reason: 'all_unavailable' });
    expect(f).not.toHaveBeenCalled();
  });
  it('un 429 de cuota diaria en embeddings se guarda con la clave embed:proveedor:perfil', async () => {
    const env = { GEMINI_API_KEY: 'k' };
    const p = embedChain(env)[0];
    const save = vi.fn(async (_b: PersistedBlock) => {});
    const f = vi.fn(async () => new Response('Quota exceeded: requests per day', { status: 429 }));
    await embedTexts(['hola'], 'document', { deps: { env, fetchImpl: f as any, health: new HealthTracker(), healthStore: { load: async () => [], save } } });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ key: `embed:${p.id}:${p.profile}`, kind: 'rate_daily' });
  });
});

describe('migracion 083 (estatica)', () => {
  const sql = read('supabase/migrations/083_ai_provider_health.sql');
  it('RLS activa, sin politicas y sin permisos para anon/authenticated', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.ai_provider_health FROM anon, authenticated/);
    expect(sql).not.toMatch(/GRANT\s/i);
  });
  it('la causa es una lista cerrada igual a la del codigo y la clave tiene forma fija', () => {
    const m = sql.match(/kind\s+text\s+NOT NULL CHECK \(kind IN \(([^)]*)\)\)/);
    expect(m).toBeTruthy();
    const kinds = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    expect(kinds).toEqual(Array.from(PERSISTABLE_KINDS).sort());
    expect(sql).toMatch(/CHECK \(key ~ '\^\[A-Za-z0-9_\.:@\/-\]\{1,200\}\$'\)/);
  });
  it('toda clave que escribe el codigo cumple la restriccion de la base', () => {
    const re = /^[A-Za-z0-9_.:@/-]{1,200}$/;
    for (const k of ['groq:openai/gpt-oss-120b', 'cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'embed:gemini:gemini-embedding-001:768:rt', 'cohere:c4ai-aya-expanse-32b']) expect(re.test(k)).toBe(true);
    expect(re.test('con espacio')).toBe(false);
    expect(re.test("a';drop table x;--")).toBe(false);
  });
});

// ───────────────────────────── 5. llamadores migrados a la pasarela ─────────────────────────────
describe('llamadores migrados: ya no hablan con Cohere ni OpenRouter a mano', () => {
  it('ningun archivo de src (salvo el adaptador) escribe la URL de Cohere', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && read(p.replace(process.cwd() + path.sep, '')).includes('api.cohere.com')) offenders.push(p.replace(process.cwd() + path.sep, '').replace(/\\/g, '/'));
      }
    };
    walk(path.join(process.cwd(), 'src'));
    // El adaptador y el catalogo de proveedores (donde la URL base figura como dato).
    expect(offenders).toEqual(['src/lib/ai/gateway/cohere.ts', 'src/lib/ai/gateway/providers.ts']);
  });
  it('fichas de estudio y taxonomia no llaman a OpenRouter directo; el PDF con vision si (es multimodal, no texto)', () => {
    expect(read('src/lib/study/generate.ts')).not.toMatch(/callOpenRouter|isOpenRouterConfigured/);
    expect(read('src/lib/questions/conceptTaxonomy.ts')).not.toMatch(/callOpenRouter|isOpenRouterConfigured/);
    expect(read('src/lib/questions/cohereGeneration.ts')).not.toMatch(/callOpenRouter|fetch\(/);
    expect(read('src/lib/ai/geminiPdf.ts')).toMatch(/callOpenRouter/);
  });
  it('latexJson.ts sigue siendo el que protege las barras de LaTeX al leer las preguntas', () => {
    expect(read('src/lib/questions/cohereGeneration.ts')).toMatch(/protectLatexBackslashes/);
    expect(read('src/lib/questions/cohereGeneration.ts')).toMatch(/escapeInvalidJsonBackslashes/);
  });
});

describe('callCohere / callStudyModel por la pasarela (comportamiento)', () => {
  const stub = (handlers: Record<string, (u: string, init?: any) => Response>) => {
    const calls: Record<string, number> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      const key = Object.keys(handlers).find((k) => u.includes(k));
      if (!key) throw new Error('destino inesperado: ' + u);
      calls[key] = (calls[key] ?? 0) + 1;
      return handlers[key](u, init);
    }));
    return calls;
  };
  beforeEach(() => {
    sharedHealth.reset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.COHERE_API_KEY = 'c';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ['COHERE_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GENERATION_PRIMARY']) delete process.env[k];
    sharedHealth.reset();
  });

  it('LaTeX: una pregunta con \\frac sin escapar que llega por Cohere conserva la barra', async () => {
    const raw = '{"questions":[{"type":"true_false","q":"Si $\\frac{a}{b}$ crece","ok":true,"exp":"e"}]}';
    stub({ 'cohere.com': () => cohereOk(raw) });
    const r = await callCohere('prompt', 1);
    expect(r![0].q).toBe('Si $\\frac{a}{b}$ crece');
  });
  it('bloqueo largo conocido de Cohere (otra instancia ya lo vio): NO se le llama y responde el respaldo', async () => {
    process.env.GROQ_API_KEY = 'g';
    sharedHealth.hydrate([{ key: 'cohere:c4ai-aya-expanse-32b', openUntil: Date.now() + HOUR }]);
    const calls = stub({
      'cohere.com': () => cohereOk('{"questions":[]}'),
      'groq.com': () => chatOk(JSON.stringify({ questions: [{ type: 'true_false', q: 'g1', ok: true, exp: 'e' }] })),
    });
    const r = await callCohere('prompt', 1);
    expect(r).toHaveLength(1);
    expect(calls['cohere.com'] ?? 0).toBe(0);
    expect(calls['groq.com']).toBe(1);
  });
  it('la cuota mensual de Cohere (429) aparta a Cohere: la siguiente generacion ni lo intenta', async () => {
    process.env.GROQ_API_KEY = 'g';
    const calls = stub({
      'cohere.com': () => new Response('{"message":"limited to 1000 API calls / month"}', { status: 429 }),
      'groq.com': () => chatOk(JSON.stringify({ questions: [{ type: 'true_false', q: 'g1', ok: true, exp: 'e' }] })),
    });
    expect(await callCohere('prompt', 1)).toHaveLength(1);
    expect(calls['cohere.com']).toBe(1); // cuota larga: sin reintento
    await callCohere('prompt', 1);
    expect(calls['cohere.com']).toBe(1); // y la segunda vez, ni se intenta
  });
  it('fichas: Cohere responde -> texto; Cohere cae -> responde el resto de la cadena "study"', async () => {
    const calls = stub({ 'cohere.com': () => cohereOk('ficha-cohere') });
    expect(await callStudyModel('p')).toBe('ficha-cohere');
    expect(calls['cohere.com']).toBe(1);

    sharedHealth.reset();
    process.env.GROQ_API_KEY = 'g';
    const calls2 = stub({ 'cohere.com': () => new Response('x', { status: 500 }), 'groq.com': () => chatOk('ficha-groq') });
    expect(await callStudyModel('p')).toBe('ficha-groq');
    expect(calls2['cohere.com']).toBe(1); // Cohere va PRIMERO (como siempre)
    expect(calls2['groq.com']).toBe(1);
  });
  it('fichas: la temperatura 0.3 llega a Cohere y el tope a 4096', async () => {
    // Se captura el cuerpo y se comprueba DESPUES: un expect dentro del mock lo tragaria el adaptador (que nunca lanza).
    let sent: any = null;
    stub({ 'cohere.com': (_u, init) => { sent = JSON.parse(init.body); return cohereOk('x'); } });
    await callStudyModel('p');
    expect(sent.temperature).toBe(0.3);
    expect(sent.max_tokens).toBe(4096);
  });
  it('preguntas: desde el 70 % de lo pedido se acepta sin molestar al respaldo; por debajo, se sigue probando', async () => {
    process.env.GROQ_API_KEY = 'g';
    const qs = (n: number) => JSON.stringify({ questions: Array.from({ length: n }, (_, i) => ({ type: 'true_false', q: `q${i}`, ok: true, exp: 'e' })) });
    const calls = stub({ 'cohere.com': () => cohereOk(qs(7)), 'groq.com': () => chatOk(qs(10)) });
    expect(await callCohere('p', 10)).toHaveLength(7);
    expect(calls['cohere.com']).toBe(1);
    expect(calls['groq.com'] ?? 0).toBe(0);

    sharedHealth.reset();
    const calls2 = stub({ 'cohere.com': () => cohereOk(qs(6)), 'groq.com': () => chatOk(qs(10)) });
    expect(await callCohere('p', 10)).toHaveLength(10);
    expect(calls2['cohere.com']).toBe(2); // con respaldo disponible, 2 intentos
    expect(calls2['groq.com']).toBe(1);
  });
  it('hasGenerationProvider: basta la llave de Cohere; sin ninguna, no hay', () => {
    expect(hasGenerationProvider()).toBe(true);
    delete process.env.COHERE_API_KEY;
    expect(hasGenerationProvider()).toBe(false);
  });
  it('fichas: sin ningun proveedor devuelve null (sin lanzar) y hasStudyProvider lo dice', async () => {
    delete process.env.COHERE_API_KEY;
    expect(hasStudyProvider()).toBe(false);
    expect(await callStudyModel('p')).toBeNull();
  });
  it('hasStudyProvider ahora tambien es cierto con SOLO un proveedor de la pasarela (antes exigia Cohere u OpenRouter)', () => {
    delete process.env.COHERE_API_KEY;
    process.env.GROQ_API_KEY = 'g';
    expect(hasStudyProvider()).toBe(true);
  });
});

describe('parseConcepts', () => {
  it('lee la lista, normaliza etiquetas y descarta tags invalidos', () => {
    const t = 'Claro: ```json\n{"concepts":[{"tag":" Oferta_Total ","label":" Oferta "},{"tag":"con espacio","label":"x"},{"tag":"ok","label":""},{"tag":"demanda","label":"Demanda"},{"tag":5,"label":"n"}]}\n```';
    expect(parseConcepts(t)).toEqual([{ tag: 'oferta_total', label: 'Oferta' }, { tag: 'demanda', label: 'Demanda' }]);
  });
  it('sin JSON, con JSON roto o sin ningun concepto valido: null (la pasarela prueba el siguiente proveedor)', () => {
    expect(parseConcepts('no hay json')).toBeNull();
    expect(parseConcepts('{"concepts":[')).toBeNull();
    expect(parseConcepts('{"concepts":[]}')).toBeNull();
    expect(parseConcepts('{"otra":1}')).toBeNull();
  });
});

// ───────────────────────────── 6. tablas transpuestas en PDF ─────────────────────────────
describe('tableCheck: deteccion de tablas transpuestas', () => {
  // El texto determinista conserva las FILAS: una por linea.
  const plain = ['Tabla 1. Demanda', 'Precio 1 2 3 4 5', 'Cantidad A 100 80 60 40 20', 'Cantidad B 90 70 50 30 10'].join('\n');
  const faithful = ['| Precio | 1 | 2 | 3 | 4 | 5 |', '|---|---|---|---|---|---|', '| Cantidad A | 100 | 80 | 60 | 40 | 20 |', '| Cantidad B | 90 | 70 | 50 | 30 | 10 |'].join('\n');
  const transposed = [
    '| Precio | Cantidad A | Cantidad B |', '|---|---|---|',
    '| 1 | 100 | 90 |', '| 2 | 80 | 70 |', '| 3 | 60 | 50 |', '| 4 | 40 | 30 |', '| 5 | 20 | 10 |',
  ].join('\n');

  it('una tabla fiel NO se acusa: sus filas caen en una linea y sus columnas, repartidas', () => {
    const r = checkTableOrientation(plain, faithful);
    expect(r.tables).toBe(1);
    expect(r.transposed).toEqual([]);
    expect(r.details[0].rowFit).toBeGreaterThanOrEqual(FIT_MIN);
    expect(r.details[0].colFit).toBeLessThan(0.5);
  });
  it('la misma tabla transpuesta SI se acusa', () => {
    const r = checkTableOrientation(plain, transposed);
    expect(r.transposed).toEqual([1]);
    expect(r.details[0].colFit).toBeGreaterThanOrEqual(FIT_MIN);
    expect(r.details[0].rowFit).toBeLessThan(0.5);
  });
  it('varias tablas: numera la transpuesta', () => {
    const r = checkTableOrientation(plain, faithful + '\n\ntexto\n\n' + transposed);
    expect(r.tables).toBe(2);
    expect(r.transposed).toEqual([2]);
  });
  it('simbolos: "\\beta" de la transcripcion encaja con "β" del texto original', () => {
    const p = ['Parametro α β γ δ', 'Valor 1 2 3 4', 'Error 5 6 7 8'].join('\n');
    const md = ['| Parametro | $\\alpha$ | $\\beta$ | $\\gamma$ | $\\delta$ |', '|---|---|---|---|---|', '| Valor | 1 | 2 | 3 | 4 |', '| Error | 5 | 6 | 7 | 8 |'].join('\n');
    const sym = (s: string) => s.replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ').replace(/\\delta/g, 'δ');
    const r = checkTableOrientation(p, md, sym);
    expect(r.tables).toBe(1);
    expect(r.details[0].rowFit).toBe(1);
  });
  it('SEGURIDAD de falsos positivos: texto original inservible (cada celda en su linea) -> no se acusa', () => {
    const cellPerLine = ['Precio', '1', '2', '3', '4', '5', 'Cantidad A', '100', '80', '60', '40', '20', 'Cantidad B', '90', '70', '50', '30', '10'].join('\n');
    expect(checkTableOrientation(cellPerLine, transposed).transposed).toEqual([]);
    expect(checkTableOrientation(cellPerLine, faithful).transposed).toEqual([]);
  });
  it('SEGURIDAD: sin texto original no se dice nada', () => {
    expect(checkTableOrientation('', transposed).transposed).toEqual([]);
    expect(checkTableOrientation('   \n  ', faithful).transposed).toEqual([]);
  });
  it('una tabla simetrica (tabla de multiplicar: filas y columnas iguales, ambas encajan) no se acusa', () => {
    const p = ['1 2 3', '2 4 6', '3 6 9'].join('\n');
    const md = ['| 1 | 2 | 3 |', '|---|---|---|', '| 2 | 4 | 6 |', '| 3 | 6 | 9 |'].join('\n');
    const r = checkTableOrientation(p, md);
    expect(r.details[0].rowFit).toBe(1);
    expect(r.details[0].colFit).toBe(1);
    expect(r.transposed).toEqual([]);
  });
  it('evidencia debil no basta: columnas que encajan a medias (50 %) con filas muy por debajo NO se acusan', () => {
    // 10 filas x 8 columnas de celdas distintas; el texto original trae cada columna partida en dos lineas de 5 celdas.
    const cell = (r: number, c: number) => `k${r}x${c}`;
    const rows = Array.from({ length: 10 }, (_, r) => Array.from({ length: 8 }, (_, c) => cell(r, c)));
    const md = [`| ${rows[0].join(' | ')} |`, `|${'---|'.repeat(8)}`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n');
    const lines: string[] = [];
    for (let c = 0; c < 8; c++) {
      lines.push(Array.from({ length: 5 }, (_, r) => cell(r, c)).join(' '));
      lines.push(Array.from({ length: 5 }, (_, r) => cell(r + 5, c)).join(' '));
    }
    const r = checkTableOrientation(lines.join('\n'), md);
    expect(r.details[0].colFit).toBeCloseTo(0.5, 5);
    expect(r.details[0].rowFit).toBeCloseTo(0.125, 5);
    expect(r.details[0].colFit).toBeLessThan(FIT_MIN);
    expect(r.transposed).toEqual([]);
  });
  it('simbolos griegos: la transposicion se ve aunque TODAS las celdas sean letras griegas en LaTeX', () => {
    const BS = String.fromCharCode(92);
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota'];
    const sym = (s: string) => names.reduce((acc, n, i) => acc.split(`${BS}${n}`).join('αβγδεζηθι'[i]), s);
    const g = (i: number) => `$${BS}${names[i]}$`;
    const p = ['α β γ', 'δ ε ζ', 'η θ ι'].join('\n');
    const row = (a: number, b: number, c: number) => `| ${g(a)} | ${g(b)} | ${g(c)} |`;
    const faithfulG = [row(0, 1, 2), '|---|---|---|', row(3, 4, 5), row(6, 7, 8)].join('\n');
    const transposedG = [row(0, 3, 6), '|---|---|---|', row(1, 4, 7), row(2, 5, 8)].join('\n');
    expect(normalizeCell(g(1), sym)).toBe('β');
    expect(checkTableOrientation(p, faithfulG, sym).transposed).toEqual([]);
    expect(checkTableOrientation(p, transposedG, sym).transposed).toEqual([1]);
    // y verifyPage (que le pasa los simbolos) llega a la misma conclusion
    const words = 'demanda consumidor elasticidad restriccion presupuestaria utilidad marginal canasta optimo';
    expect(verifyPage([words, p].join('\n'), [words, transposedG].join('\n'), () => {}).reasons.join(' ')).toMatch(/transpuesta/);
    expect(verifyPage([words, p].join('\n'), [words, faithfulG].join('\n'), () => {}).reasons.join(' ')).not.toMatch(/transpuesta/);
  });
  it('un grupo con menos de 3 celdas utiles no se compara (sin evidencia, no se opina)', () => {
    const t = { rows: [['a', 'b', ''], ['c', 'd', ''], ['e', 'f', '']] };
    expect(tableOrientation(t, ['a b', 'c d', 'e f'])).toBeNull();
  });
  it('tablas demasiado chicas (menos de 3 filas o 3 columnas) o enormes se ignoran', () => {
    expect(extractMarkdownTables('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')).toHaveLength(0);
    expect(extractMarkdownTables('| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |')).toHaveLength(0);
    const wide = '| ' + Array.from({ length: 13 }, (_, i) => `c${i}`).join(' | ') + ' |';
    const sep = '|' + '---|'.repeat(13);
    expect(extractMarkdownTables([wide, sep, wide, wide].join('\n'))).toHaveLength(0);
  });
  it('un bloque con "|" pero sin fila de separadores no es una tabla', () => {
    expect(extractMarkdownTables('| a | b | c |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |')).toHaveLength(0);
  });
  it('el separador solo vale justo despues del encabezado: una fila de guiones (celdas vacias) mas abajo es dato', () => {
    const t = extractMarkdownTables('| a | b | c |\n|---|---|---|\n| - | - | - |\n| 1 | 2 | 3 |')[0];
    expect(t.rows).toEqual([['a', 'b', 'c'], ['-', '-', '-'], ['1', '2', '3']]);
    expect(extractMarkdownTables('| a | b | c |\n| 1 | 2 | 3 |\n|---|---|---|\n| 4 | 5 | 6 |')).toHaveLength(0);
  });
  it('extractMarkdownTables: separa el encabezado del separador, completa filas cortas y respeta \\|', () => {
    const t = extractMarkdownTables('intro\n\n| x | y \\| z | w |\n|:--|:-:|--:|\n| 1 | 2 |\n| 3 | 4 | 5 |\n\nfin')[0];
    expect(t.rows).toEqual([['x', 'y \\| z', 'w'], ['1', '2', ''], ['3', '4', '5']]);
  });
  it('no mas de MAX_TABLES por pagina', () => {
    const one = '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\n';
    expect(extractMarkdownTables(one.repeat(9))).toHaveLength(5);
  });
  it('cellsInLine: palabra completa ("5" no cuenta dentro de "15") y cada repeticion necesita su lugar', () => {
    expect(cellsInLine(['5'], '15 25 35')).toBe(0);
    expect(cellsInLine(['5'], '1 5 3')).toBe(1);
    expect(cellsInLine(['5', '5'], '1 5 3')).toBe(1);
    expect(cellsInLine(['5', '5'], '5 5 3')).toBe(2);
    expect(cellsInLine(['precio unitario', 'qty'], 'el precio unitario y qty')).toBe(2);
    expect(cellsInLine(['é'], 'zé')).toBe(0);
  });
  it('normalizeCell: tildes, mayusculas, marcas de Markdown y LaTeX, espacios', () => {
    expect(normalizeCell('  **Cantidad  Demandada** ')).toBe('cantidad demandada');
    expect(normalizeCell('$P_1$')).toBe('p 1');
    expect(normalizeCell('Elasticidad—Precio')).toBe('elasticidad—precio');
    expect(normalizeCell('\\$2')).toBe('2');
    expect(normalizeCell('Ñandú')).toBe('nandu');
  });
  it('tableOrientation: devuelve null cuando ninguna fila ni columna tiene 3 celdas utiles', () => {
    const t = { rows: [['', '', ''], ['', '', ''], ['', '', '']] };
    expect(tableOrientation(t, ['a b c'])).toBeNull();
  });
  it('LIMITE CONOCIDO: una tabla girada 90 grados en el PDF hace que una transcripcion fiel parezca transpuesta (el costo es seguro: vuelve al texto determinista)', () => {
    const rotatedPlain = ['Precio Cantidad A Cantidad B', '1 100 90', '2 80 70', '3 60 50', '4 40 30', '5 20 10'].join('\n');
    expect(checkTableOrientation(rotatedPlain, faithful).transposed).toEqual([1]);
  });
});

describe('verifyPage y convertPdfToMarkdown usan el detector', () => {
  const noRender = () => {};
  const words = 'demanda consumidor elasticidad restriccion presupuestaria utilidad marginal canasta optimo';
  const plain = [words, 'Tabla 1', 'Precio 1 2 3 4 5', 'Cantidad A 100 80 60 40 20', 'Cantidad B 90 70 50 30 10'].join('\n');
  const faithful = [words, '', '| Precio | 1 | 2 | 3 | 4 | 5 |', '|---|---|---|---|---|---|', '| Cantidad A | 100 | 80 | 60 | 40 | 20 |', '| Cantidad B | 90 | 70 | 50 | 30 | 10 |'].join('\n');
  const transposed = [words, '', '| Precio | Cantidad A | Cantidad B |', '|---|---|---|', '| 1 | 100 | 90 |', '| 2 | 80 | 70 |', '| 3 | 60 | 50 |', '| 4 | 40 | 30 |', '| 5 | 20 | 10 |'].join('\n');

  it('la tabla fiel pasa la verificacion; la transpuesta NO, con el motivo', () => {
    expect(verifyPage(plain, faithful, noRender)).toEqual({ ok: true, reasons: [] });
    const v = verifyPage(plain, transposed, noRender);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/la tabla 1 parece estar transpuesta/);
  });
  it('verifyPage pasa los simbolos griegos: una tabla con beta en LaTeX se compara contra la beta del texto original', () => {
    const NL = String.fromCharCode(10);
    const BS = String.fromCharCode(92);
    const a = `$${BS}alpha$`;
    const b = `$${BS}beta$`;
    const g = `$${BS}gamma$`;
    const p = [words, 'Parametro α β γ', 'Valor 1 2 3', 'Error 5 6 7'].join(NL);
    const md = (rows: string[]) => [words, '', ...rows].join(NL);
    const bad = md(['| Parametro | Valor | Error |', '|---|---|---|', `| ${a} | 1 | 5 |`, `| ${b} | 2 | 6 |`, `| ${g} | 3 | 7 |`]);
    expect(verifyPage(p, bad, noRender).reasons.join(' ')).toMatch(/transpuesta/);
    const ok = md([`| Parametro | ${a} | ${b} | ${g} |`, '|---|---|---|---|', '| Valor | 1 | 2 | 3 |', '| Error | 5 | 6 | 7 |']);
    expect(verifyPage(p, ok, noRender).reasons.join(' ')).not.toMatch(/transpuesta/);
  });
  it('en la conversion de un PDF, la pagina con la tabla transpuesta se queda con el texto determinista', async () => {
    const page: PageData = { number: 1, markdown: 'DETERMINISTA-' + plain, text: plain, chars: plain.length, unreadable: 3, risk: ['tabla'] };
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const run = async (answer: string) => {
      const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: true, text: `[[PAGINA 1]]\n${answer}`, provider: 'gemini', model: 'm', promptTokens: 1, outputTokens: 1 }));
      return convertPdfToMarkdown(bytes, { readPages: async () => [page], slice: async () => new Uint8Array([1]), vision, render: noRender, sleep: async () => {} });
    };
    const bad = await run(transposed);
    expect(bad.markdown).toContain('DETERMINISTA-');
    expect(bad.markdown).not.toContain('| 1 | 100 | 90 |');
    expect(bad.report.ai_pages_rejected[0].reasons.join(' ')).toMatch(/transpuesta/);
    const good = await run(faithful);
    expect(good.method).toBe('hybrid');
    expect(good.markdown).toContain('| Cantidad A | 100 |');
  });
});
