import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callOpenRouter, openRouterModels, isOpenRouterConfigured, classifyStatus, DEFAULT_MODELS } from './openrouter';

const ok = (content: string, model = 'meta-llama/llama-3.3-70b-instruct') =>
  new Response(JSON.stringify({ model, choices: [{ message: { content } }] }), { status: 200 });

const noSleep = async () => {};

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'or-test';
  delete process.env.OPENROUTER_GENERATION_MODELS;
  delete process.env.OPENROUTER_JUDGE_MODELS;
});
afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe('configuracion', () => {
  it('sin llave no esta configurado y no sale a la red', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const f = vi.fn();
    expect(isOpenRouterConfigured()).toBe(false);
    expect(await callOpenRouter('hola', { role: 'generation', fetchImpl: f as any })).toEqual({ ok: false, reason: 'no_key' });
    expect(f).not.toHaveBeenCalled();
  });

  it('usa modelos por defecto distintos para generar y para juzgar', () => {
    expect(openRouterModels('generation')).toEqual(DEFAULT_MODELS.generation);
    expect(openRouterModels('judge')).toEqual(DEFAULT_MODELS.judge);
    // El juez no debe empezar con el mismo modelo que genera.
    expect(DEFAULT_MODELS.judge[0]).not.toBe(DEFAULT_MODELS.generation[0]);
  });

  it('se pueden cambiar por variable de entorno, sin espacios ni vacios, maximo 3', () => {
    process.env.OPENROUTER_GENERATION_MODELS = ' a/uno , b/dos ,, c/tres , d/cuatro ';
    expect(openRouterModels('generation')).toEqual(['a/uno', 'b/dos', 'c/tres']);
  });

  it('una variable vacia usa los defaults', () => {
    process.env.OPENROUTER_JUDGE_MODELS = '  ,  ';
    expect(openRouterModels('judge')).toEqual(DEFAULT_MODELS.judge);
  });
});

describe('callOpenRouter', () => {
  it('devuelve el texto y el modelo que respondio; manda llave, lista de modelos y temperatura del rol', async () => {
    const f = vi.fn(async () => ok('{"questions":[]}', 'openai/gpt-4o-mini'));
    const r = await callOpenRouter('prompt', { role: 'judge', fetchImpl: f as any, sleep: noSleep });
    expect(r).toEqual({ ok: true, text: '{"questions":[]}', model: 'openai/gpt-4o-mini' });
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer or-test');
    const body = JSON.parse(init.body);
    expect(body.models).toEqual(DEFAULT_MODELS.judge);
    expect(body.model).toBe(DEFAULT_MODELS.judge[0]);
    expect(body.temperature).toBe(0); // el juez es determinista
    expect(body.messages).toEqual([{ role: 'user', content: 'prompt' }]);
  });

  it('un error 5xx transitorio se reintenta y se recupera', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('boom', { status: 503 })).mockResolvedValueOnce(ok('listo'));
    const r = await callOpenRouter('p', { role: 'generation', fetchImpl: f as any, sleep: noSleep });
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 400, 402])('HTTP %i no se reintenta: repetirlo no cambia nada', async (status) => {
    const f = vi.fn(async () => new Response('no', { status }));
    const r = await callOpenRouter('p', { role: 'generation', fetchImpl: f as any, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('un fallo persistente devuelve la causa y el codigo HTTP', async () => {
    const f = vi.fn(async () => new Response('x', { status: 503 }));
    const r = await callOpenRouter('p', { role: 'generation', fetchImpl: f as any, sleep: noSleep });
    expect(r).toEqual({ ok: false, reason: 'server', status: 503 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('un 200 con error dentro del cuerpo NO se toma por exito', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { code: 429, message: 'limite' } }), { status: 200 }));
    const r = await callOpenRouter('p', { role: 'generation', fetchImpl: f as any, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('rate_limited');
  });

  it('contenido vacio es un fallo, no un exito con texto vacio', async () => {
    const f = vi.fn(async () => ok('   '));
    const r = await callOpenRouter('p', { role: 'generation', fetchImpl: f as any, sleep: noSleep });
    expect(r).toEqual({ ok: false, reason: 'empty' });
  });

  it('un timeout se reporta como timeout y no lanza', async () => {
    const f = vi.fn(async () => {
      const e = new Error('tiempo');
      e.name = 'TimeoutError';
      throw e;
    });
    const r = await callOpenRouter('p', { role: 'generation', fetchImpl: f as any, sleep: noSleep });
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });

  it('una caida de red no lanza', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(callOpenRouter('p', { role: 'generation', fetchImpl: f as any, sleep: noSleep })).resolves.toMatchObject({ ok: false, reason: 'server' });
  });

  it('classifyStatus', () => {
    expect(classifyStatus(401)).toBe('unauthorized');
    expect(classifyStatus(429)).toBe('rate_limited');
    expect(classifyStatus(502)).toBe('server');
    expect(classifyStatus(422)).toBe('bad_request');
  });
});
