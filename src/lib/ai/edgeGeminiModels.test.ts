import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MODELS,
  generateContent,
  parseModels,
  resetUnavailableModels,
  shouldFallback,
  thinkingConfigFor,
} from '../../../supabase/functions/_shared/geminiModels';

const ok = (text = '{}') => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const fail = (status: number, msg = 'x') => new Response(msg, { status });

describe('edge functions: lista de modelos de Gemini', () => {
  beforeEach(() => resetUnavailableModels());

  it('sin secreto usa la lista por defecto, con el modelo de siempre primero', () => {
    expect(parseModels(undefined)).toEqual(DEFAULT_MODELS);
    expect(DEFAULT_MODELS[0]).toBe('gemini-2.5-flash');
    expect(DEFAULT_MODELS).toContain('gemini-3.5-flash-lite');
  });

  it('GEMINI_MODELS se parte por comas, sin espacios ni repetidos', () => {
    expect(parseModels(' gemini-3.5-flash-lite , gemini-3.5-flash,,gemini-3.5-flash ')).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash']);
    expect(parseModels('  ,')).toEqual(DEFAULT_MODELS);
  });

  it('el ajuste de pensar depende de la familia (si no, HTTP 400)', () => {
    expect(thinkingConfigFor('gemini-2.5-flash')).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingConfigFor('gemini-2.5-flash-lite')).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingConfigFor('gemini-3.5-flash')).toEqual({ thinkingConfig: { thinkingLevel: 'minimal' } });
    expect(thinkingConfigFor('gemini-3.5-flash-lite')).toEqual({});
    expect(thinkingConfigFor('gemini-3.1-flash-lite')).toEqual({});
  });

  it('solo hay respaldo ante 404/403/429/5xx, no ante 400/401', () => {
    for (const s of [404, 403, 429, 500, 503]) expect(shouldFallback(s)).toBe(true);
    for (const s of [400, 401, 422]) expect(shouldFallback(s)).toBe(false);
  });

  it('pasa al siguiente modelo ante 404 y manda el pensar que le toca a cada uno, sin tocar el prompt', async () => {
    const f = vi.fn().mockResolvedValueOnce(fail(404)).mockResolvedValueOnce(ok('{"a":1}'));
    const body = { contents: [{ role: 'user', parts: [{ text: 'hola' }] }], generationConfig: { responseMimeType: 'application/json' } };
    const r = await generateContent('KEY', body, ['gemini-2.5-flash', 'gemini-3.5-flash-lite'], 'T', f as unknown as typeof fetch);
    expect(r.model).toBe('gemini-3.5-flash-lite');
    const [url1, init1] = f.mock.calls[0];
    const [url2, init2] = f.mock.calls[1];
    expect(url1).toContain('/models/gemini-2.5-flash:generateContent');
    expect(url2).toContain('/models/gemini-3.5-flash-lite:generateContent');
    const b1 = JSON.parse(init1.body);
    const b2 = JSON.parse(init2.body);
    expect(b1.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(b2.generationConfig.thinkingConfig).toBeUndefined();
    expect(b1.generationConfig.responseMimeType).toBe('application/json');
    expect(b2.contents).toEqual(body.contents);
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' }); // no se muta el original
  });

  it('un 404 se recuerda: la siguiente peticion no vuelve a probar el modelo muerto', async () => {
    const f = vi.fn().mockResolvedValueOnce(fail(404)).mockImplementation(async () => ok());
    const models = ['gemini-2.5-flash', 'gemini-3.5-flash-lite'];
    await generateContent('K', {}, models, 'T', f as unknown as typeof fetch);
    await generateContent('K', {}, models, 'T', f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls[2][0]).toContain('gemini-3.5-flash-lite');
  });

  it('un 429 no se recuerda (es pasajero)', async () => {
    const f = vi.fn().mockResolvedValueOnce(fail(429)).mockImplementation(async () => ok());
    const models = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
    await generateContent('K', {}, models, 'T', f as unknown as typeof fetch);
    await generateContent('K', {}, models, 'T', f as unknown as typeof fetch);
    expect(f.mock.calls[2][0]).toContain('gemini-3.5-flash:');
  });

  it('un 400 corta de inmediato y un fallo de red pasa al siguiente', async () => {
    const f400 = vi.fn().mockImplementation(async () => fail(400, 'mal'));
    await expect(generateContent('K', {}, ['a', 'b'], 'T', f400 as unknown as typeof fetch)).rejects.toThrow(/400/);
    expect(f400).toHaveBeenCalledTimes(1);

    const fnet = vi.fn().mockRejectedValueOnce(new Error('caido')).mockResolvedValueOnce(ok());
    const r = await generateContent('K', {}, ['a', 'b'], 'T', fnet as unknown as typeof fetch);
    expect(r.model).toBe('b');
  });

  it('si todos fallan, el error lista cada modelo y nunca incluye la llave', async () => {
    const f = vi.fn().mockImplementation(async () => fail(503));
    const err = await generateContent('SECRETA123', {}, ['a', 'b'], 'T', f as unknown as typeof fetch).then(() => new Error('no fallo'), (e: Error) => e);
    expect(err.message).toMatch(/a: 503; b: 503/);
    expect(err.message).not.toContain('SECRETA123');
  });
});

describe('edge functions: usan el helper y no un modelo escrito a mano', () => {
  const read = (fn: string) => fs.readFileSync(path.join(process.cwd(), 'supabase/functions', fn, 'index.ts'), 'utf8');
  it.each(['process-material', 'generate-classroom-map', 'generate-lesson-from-material'])('%s', (fn) => {
    const src = read(fn);
    expect(src).toContain("from '../_shared/geminiModels.ts'");
    expect(src).not.toMatch(/GEMINI_CHAT_MODEL/);
    expect(src).not.toMatch(/models\/gemini-/);
  });
});
