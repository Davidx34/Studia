import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { callCohere, hasGenerationProvider } from './cohereGeneration';
import { judgeQuestionsBatch, resetQuotaBreaker } from './judge';

// fetch simulado por destino. Cada proveedor responde lo que el test le indique.
type Handler = (url: string, init?: any) => Response | Promise<Response>;
function stubFetch(handlers: { cohere?: Handler; openrouter?: Handler; gemini?: Handler }) {
  const calls = { cohere: 0, openrouter: 0, gemini: 0 };
  const f = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes('cohere.com')) {
      calls.cohere++;
      return handlers.cohere!(u, init);
    }
    if (u.includes('openrouter.ai')) {
      calls.openrouter++;
      return handlers.openrouter!(u, init);
    }
    if (u.includes('generativelanguage')) {
      calls.gemini++;
      return handlers.gemini!(u, init);
    }
    throw new Error('destino inesperado: ' + u);
  });
  vi.stubGlobal('fetch', f);
  return calls;
}

const questions = (n: number, tag = 'q') => Array.from({ length: n }, (_, i) => ({ type: 'true_false', q: `${tag}${i}`, ok: true, exp: 'e' }));
const cohereOk = (n: number) => new Response(JSON.stringify({ message: { content: [{ text: JSON.stringify({ questions: questions(n, 'cohere') }) }] } }), { status: 200 });
const orOk = (text: string) => new Response(JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct', choices: [{ message: { content: text } }] }), { status: 200 });
const orQuestions = (n: number) => orOk(JSON.stringify({ questions: questions(n, 'or') }));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.env.COHERE_API_KEY = 'c';
  process.env.OPENROUTER_API_KEY = 'o';
  process.env.GEMINI_API_KEY = 'g';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.COHERE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

describe('generacion: Cohere primero, OpenRouter de respaldo', () => {
  it('si Cohere responde bien, OpenRouter NO se llama', async () => {
    const calls = stubFetch({ cohere: () => cohereOk(10), openrouter: () => orQuestions(10) });
    const r = await callCohere('prompt', 10);
    expect(r).toHaveLength(10);
    expect(r![0].q).toMatch(/^cohere/);
    expect(calls.openrouter).toBe(0);
  });

  it('Cohere caido (500): pasa a OpenRouter y devuelve sus preguntas', async () => {
    const calls = stubFetch({ cohere: () => new Response('boom', { status: 500 }), openrouter: () => orQuestions(10) });
    const r = await callCohere('prompt', 10);
    expect(r).toHaveLength(10);
    expect(r![0].q).toMatch(/^or/);
    // Con respaldo disponible Cohere reintenta 2 veces, no 3.
    expect(calls.cohere).toBe(2);
    expect(calls.openrouter).toBe(1);
  }, 20_000);

  it('Cohere con la red caida (excepcion): no lanza y pasa al respaldo', async () => {
    const calls = stubFetch({
      cohere: () => {
        throw new TypeError('fetch failed');
      },
      openrouter: () => orQuestions(10),
    });
    await expect(callCohere('prompt', 10)).resolves.toHaveLength(10);
    expect(calls.openrouter).toBe(1);
  }, 20_000);

  it('Cohere da respuesta parcial: si el respaldo da mas, se usa el respaldo', async () => {
    stubFetch({ cohere: () => cohereOk(3), openrouter: () => orQuestions(10) });
    const r = await callCohere('prompt', 10);
    expect(r).toHaveLength(10);
  }, 20_000);

  it('el respaldo NUNCA empeora lo que Cohere ya dio', async () => {
    stubFetch({ cohere: () => cohereOk(6), openrouter: () => orQuestions(2) });
    const r = await callCohere('prompt', 10);
    expect(r).toHaveLength(6);
    expect(r![0].q).toMatch(/^cohere/);
  }, 20_000);

  it('sin llave de Cohere pero con OpenRouter, igual genera', async () => {
    delete process.env.COHERE_API_KEY;
    const calls = stubFetch({ openrouter: () => orQuestions(5) });
    expect(hasGenerationProvider()).toBe(true);
    await expect(callCohere('prompt', 5)).resolves.toHaveLength(5);
    expect(calls.cohere).toBe(0);
  });

  it('OpenRouter con llave invalida (401): no insiste', async () => {
    const calls = stubFetch({ cohere: () => new Response('x', { status: 500 }), openrouter: () => new Response('no', { status: 401 }) });
    expect(await callCohere('prompt', 10)).toBeNull();
    expect(calls.openrouter).toBe(1);
  }, 20_000);

  it('SIN llave de OpenRouter el comportamiento es el de siempre: 3 intentos y nada mas', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const calls = stubFetch({ cohere: () => new Response('boom', { status: 500 }) });
    expect(await callCohere('prompt', 10)).toBeNull();
    expect(calls.cohere).toBe(3);
    expect(calls.openrouter).toBe(0);
  }, 20_000);

  it('sin ningun proveedor no hay generacion', async () => {
    delete process.env.COHERE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    expect(hasGenerationProvider()).toBe(false);
    expect(await callCohere('prompt', 10)).toBeNull();
  });
});

describe('juez: Gemini primero, OpenRouter cuando Gemini no puede', () => {
  const qs = [
    { id: 'a', type: 'true_false', q: 'La oferta sube con el precio', ok: true, exp: 'e' },
    { id: 'b', type: 'true_false', q: 'La demanda sube con el precio', ok: false, exp: 'e' },
  ];
  const verdicts = JSON.stringify({ verdicts: [{ index: 1, verdict: 'pass', reason: 'correcta' }, { index: 2, verdict: 'fail', reason: 'incorrecta' }] });
  const cuotaDiaria = () => new Response('{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}', { status: 429 });

  beforeEach(() => resetQuotaBreaker());

  it('cuota diaria de Gemini agotada: el veredicto lo da OpenRouter en vez de quedar en blanco', async () => {
    const calls = stubFetch({ gemini: cuotaDiaria, openrouter: () => orOk(verdicts) });
    const r = await judgeQuestionsBatch(qs, 'material');
    expect(r.get('a')).toEqual({ verdict: 'pass', reason: 'correcta' });
    expect(r.get('b')).toEqual({ verdict: 'fail', reason: 'incorrecta' });
    expect(calls.gemini).toBe(1);
    expect(calls.openrouter).toBe(1);
  });

  it('con el cortacircuito de cuota abierto sigue juzgando por el respaldo sin volver a tocar Gemini', async () => {
    const calls = stubFetch({ gemini: cuotaDiaria, openrouter: () => orOk(verdicts) });
    await judgeQuestionsBatch(qs, 'material');
    await judgeQuestionsBatch(qs, 'material');
    expect(calls.gemini).toBe(1);
    expect(calls.openrouter).toBe(2);
  });

  it('sin llave de Gemini tambien usa el respaldo', async () => {
    delete process.env.GEMINI_API_KEY;
    stubFetch({ openrouter: () => orOk(verdicts) });
    const r = await judgeQuestionsBatch(qs, 'material');
    expect(r.get('a')?.verdict).toBe('pass');
  });

  it('SEGURIDAD: si el respaldo tambien falla, NADIE queda aprobado por omision', async () => {
    stubFetch({ gemini: cuotaDiaria, openrouter: () => new Response('x', { status: 503 }) });
    const r = await judgeQuestionsBatch(qs, 'material');
    expect(r.get('a')).toBeNull();
    expect(r.get('b')).toBeNull();
  }, 20_000);

  it('SEGURIDAD: una respuesta ilegible del respaldo no inventa veredictos', async () => {
    stubFetch({ gemini: cuotaDiaria, openrouter: () => orOk('no es json') });
    const r = await judgeQuestionsBatch(qs, 'material');
    expect(r.get('a')).toBeNull();
  });

  it('SEGURIDAD: un lote con el numero de veredictos equivocado se descarta', async () => {
    stubFetch({ gemini: cuotaDiaria, openrouter: () => orOk(JSON.stringify({ verdicts: [{ index: 1, verdict: 'pass', reason: 'x' }] })) });
    const r = await judgeQuestionsBatch(qs, 'material');
    expect(r.get('a')).toBeNull();
  });

  it('sin llave de OpenRouter el juez se comporta como siempre: sin veredicto', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const calls = stubFetch({ gemini: cuotaDiaria });
    const r = await judgeQuestionsBatch(qs, 'material');
    expect(r.get('a')).toBeNull();
    expect(calls.openrouter).toBe(0);
  });

  it('si Gemini responde, OpenRouter NO se llama', async () => {
    const geminiOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: verdicts }] } }] }), { status: 200 });
    const calls = stubFetch({ gemini: geminiOk, openrouter: () => orOk(verdicts) });
    const r = await judgeQuestionsBatch(qs, 'material');
    expect(r.get('a')?.verdict).toBe('pass');
    expect(calls.openrouter).toBe(0);
  });
});

const read = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g'), String.fromCharCode(10));

describe('cableado', () => {
  it('ninguna ruta exige COHERE_API_KEY a secas: la puerta es hasGenerationProvider', () => {
    for (const f of ['src/app/api/generate-questions/route.ts', 'src/lib/questions/regeneratePool.ts']) {
      expect(read(f)).not.toContain('process.env.COHERE_API_KEY');
      expect(read(f)).toContain('hasGenerationProvider()');
    }
  });

  it('la llave de OpenRouter solo se lee en el servidor (nunca NEXT_PUBLIC_)', () => {
    expect(read('src/lib/ai/openrouter.ts')).not.toContain('NEXT_PUBLIC_OPENROUTER');
  });
});
