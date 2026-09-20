import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callGeminiPdf, callOpenRouterPdf, callPdfVision, geminiPdfModels, DEFAULT_GEMINI_PDF_MODELS, isGeminiDailyQuota } from './geminiPdf';

const geminiOk = (text = '[[PAGINA 1]]\nhola') =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 258, candidatesTokenCount: 10 } }), { status: 200 });
const cuotaDiaria = () => new Response('{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}', { status: 429 });

function fetchByModel(handlers: Record<string, () => Response>) {
  const calls: string[] = [];
  const f = vi.fn(async (url: any) => {
    const model = String(url).match(/models\/([^:]+):/)?.[1] ?? 'openrouter';
    calls.push(model);
    return (handlers[model] ?? (() => new Response('sin manejador', { status: 500 })))();
  });
  return { f: f as unknown as typeof fetch, calls };
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'g';
  delete process.env.GEMINI_PDF_MODELS;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_CONNECTOR;
});
afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe('modelos de Gemini para PDFs', () => {
  it('el primero NO es el del juez (cuota propia) y hay un segundo de respaldo', () => {
    expect(DEFAULT_GEMINI_PDF_MODELS[0]).toBe('gemini-2.5-flash-lite');
    expect(DEFAULT_GEMINI_PDF_MODELS.length).toBeGreaterThan(1);
  });

  it('se pueden cambiar por variable de entorno', () => {
    process.env.GEMINI_PDF_MODELS = ' a , b ,, ';
    expect(geminiPdfModels()).toEqual(['a', 'b']);
  });

  it('isGeminiDailyQuota distingue la cuota diaria de un limite por minuto', () => {
    expect(isGeminiDailyQuota(429, 'quotaId GenerateRequestsPerDayPerProjectPerModel')).toBe(true);
    expect(isGeminiDailyQuota(429, 'PerMinute')).toBe(false);
    expect(isGeminiDailyQuota(500, 'PerDay')).toBe(false);
  });
});

describe('callGeminiPdf', () => {
  it('devuelve el texto, el modelo que respondio y los tokens', async () => {
    const { f, calls } = fetchByModel({ 'gemini-2.5-flash-lite': () => geminiOk() });
    const r = await callGeminiPdf('QUJD', 'prompt', { fetchImpl: f });
    expect(r).toMatchObject({ ok: true, provider: 'gemini', model: 'gemini-2.5-flash-lite', promptTokens: 258, outputTokens: 10 });
    expect(calls).toEqual(['gemini-2.5-flash-lite']);
  });

  it('manda el PDF como inline_data y pide temperatura 0 sin "pensar"', async () => {
    const { f } = fetchByModel({ 'gemini-2.5-flash-lite': () => geminiOk() });
    await callGeminiPdf('QUJD', 'prompt', { fetchImpl: f });
    const body = JSON.parse((f as any).mock.calls[0][1].body);
    expect(body.contents[0].parts[0]).toEqual({ inline_data: { mime_type: 'application/pdf', data: 'QUJD' } });
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });

  it('cuota agotada en el primer modelo: prueba el segundo', async () => {
    const { f, calls } = fetchByModel({ 'gemini-2.5-flash-lite': cuotaDiaria, 'gemini-2.5-flash': () => geminiOk() });
    const r = await callGeminiPdf('QUJD', 'p', { fetchImpl: f });
    expect(r).toMatchObject({ ok: true, model: 'gemini-2.5-flash' });
    expect(calls).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
  });

  it('un 503 en el primero tambien pasa al segundo', async () => {
    const { f } = fetchByModel({ 'gemini-2.5-flash-lite': () => new Response('overloaded', { status: 503 }), 'gemini-2.5-flash': () => geminiOk() });
    expect((await callGeminiPdf('QUJD', 'p', { fetchImpl: f })).ok).toBe(true);
  });

  it('REGRESION: un modelo sobrecargado (503) y otro sin cuota -> se reporta el 503 (reintentable), no "quota"', async () => {
    // Asi fallo el PDF real: flash-lite daba 503 y flash estaba sin cuota; reportar "quota" hacia que
    // el llamador no reintentara algo que si podia funcionar.
    const { f } = fetchByModel({ 'gemini-2.5-flash-lite': () => new Response('overloaded', { status: 503 }), 'gemini-2.5-flash': cuotaDiaria });
    expect(await callGeminiPdf('QUJD', 'p', { fetchImpl: f })).toMatchObject({ ok: false, reason: 'server', status: 503 });
  });

  it('todos sin cuota: devuelve "quota"', async () => {
    const { f } = fetchByModel({ 'gemini-2.5-flash-lite': cuotaDiaria, 'gemini-2.5-flash': cuotaDiaria });
    expect(await callGeminiPdf('QUJD', 'p', { fetchImpl: f })).toMatchObject({ ok: false, reason: 'quota' });
  });

  it('un 400 (PDF demasiado grande) NO prueba otros modelos: es de esta peticion', async () => {
    const { f, calls } = fetchByModel({ 'gemini-2.5-flash-lite': () => new Response('too large', { status: 400 }) });
    expect(await callGeminiPdf('QUJD', 'p', { fetchImpl: f })).toMatchObject({ ok: false, reason: 'bad_request' });
    expect(calls).toHaveLength(1);
  });

  it('sin llave de Gemini: no_key y no sale a la red', async () => {
    delete process.env.GEMINI_API_KEY;
    const f = vi.fn();
    expect(await callGeminiPdf('QUJD', 'p', { fetchImpl: f as any })).toEqual({ ok: false, reason: 'no_key' });
    expect(f).not.toHaveBeenCalled();
  });

  it('una respuesta vacia es un fallo, no un exito', async () => {
    const { f } = fetchByModel({ 'gemini-2.5-flash-lite': () => geminiOk('  '), 'gemini-2.5-flash': () => geminiOk('  ') });
    expect(await callGeminiPdf('QUJD', 'p', { fetchImpl: f })).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('una excepcion de red no lanza', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(callGeminiPdf('QUJD', 'p', { fetchImpl: f as any })).resolves.toMatchObject({ ok: false, reason: 'server' });
  });
});

describe('callOpenRouterPdf y la cadena', () => {
  it('sin OpenRouter configurado: no_key', async () => {
    expect(await callOpenRouterPdf('QUJD', 'p')).toEqual({ ok: false, reason: 'no_key' });
  });

  it('OpenRouter sin saldo (402): se reporta como no_credit', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    const f = vi.fn(async () => new Response('{"error":{"code":402,"message":"requires at least $0.50"}}', { status: 402 }));
    expect(await callOpenRouterPdf('QUJD', 'p', { fetchImpl: f as any })).toMatchObject({ ok: false, reason: 'no_credit', status: 402 });
    delete process.env.OPENROUTER_API_KEY;
  });

  it('manda el PDF como archivo adjunto en base64', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    const f = vi.fn(async () => new Response(JSON.stringify({ model: 'google/gemini-2.5-flash', choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    const r = await callOpenRouterPdf('QUJD', 'transcribe', { fetchImpl: f as any });
    expect(r).toMatchObject({ ok: true, provider: 'openrouter' });
    const body = JSON.parse((f.mock.calls[0] as any)[1].body);
    const content = body.messages[0].content;
    expect(content[0]).toEqual({ type: 'text', text: 'transcribe' });
    expect(content[1].type).toBe('file');
    expect(content[1].file.file_data).toBe('data:application/pdf;base64,QUJD');
    expect(body.temperature).toBe(0);
    delete process.env.OPENROUTER_API_KEY;
  });

  it('cadena: si Gemini no puede, prueba OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    const f = vi.fn(async (url: any) => {
      if (String(url).includes('openrouter')) return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: 'del respaldo' } }] }), { status: 200 });
      return cuotaDiaria();
    });
    const r = await callPdfVision('QUJD', 'p', { fetchImpl: f as any });
    expect(r).toMatchObject({ ok: true, provider: 'openrouter', text: 'del respaldo' });
    delete process.env.OPENROUTER_API_KEY;
  });

  it('cadena: si TODO falla se reporta la causa del proveedor principal (Gemini)', async () => {
    const f = vi.fn(async () => cuotaDiaria());
    expect(await callPdfVision('QUJD', 'p', { fetchImpl: f as any })).toMatchObject({ ok: false, reason: 'quota' });
  });

  it('cadena: un 400 de Gemini no se manda a otro proveedor', async () => {
    process.env.OPENROUTER_API_KEY = 'o';
    const f = vi.fn(async () => new Response('too large', { status: 400 }));
    const r = await callPdfVision('QUJD', 'p', { fetchImpl: f as any });
    expect(r).toMatchObject({ ok: false, reason: 'bad_request' });
    expect((f.mock.calls as any[]).some((c) => String(c[0]).includes('openrouter'))).toBe(false);
    delete process.env.OPENROUTER_API_KEY;
  });
});
