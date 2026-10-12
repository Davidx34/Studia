import { describe, it, expect } from 'vitest';
import { callCandidate, reasoningEffortFor } from './client';
import { DEFAULT_CHAINS } from './providers';

const ok = (text = 'OK') => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const err = (status: number, body: string) => new Response(body, { status });

function recorder(handler: (body: any) => Response) {
  const bodies: any[] = [];
  const f = (async (_u: any, init: any) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    return handler(b);
  }) as unknown as typeof fetch;
  return { f, bodies };
}

describe('esfuerzo de razonamiento de los modelos gpt-oss', () => {
  it('solo gpt-oss en Groq y Cerebras lo reciben: bajo para juzgar/analizar, medio para generar', () => {
    expect(reasoningEffortFor('groq', 'openai/gpt-oss-120b', 'judge')).toBe('low');
    expect(reasoningEffortFor('groq', 'openai/gpt-oss-20b', 'analysis')).toBe('low');
    expect(reasoningEffortFor('cerebras', 'gpt-oss-120b', 'generation')).toBe('medium');
    expect(reasoningEffortFor('groq', 'openai/gpt-oss-120b', 'study')).toBe('medium');
    expect(reasoningEffortFor('groq', 'qwen/qwen3.8-27b', 'judge')).toBeNull();
    expect(reasoningEffortFor('gemini', 'gemini-2.5-flash', 'judge')).toBeNull();
    expect(reasoningEffortFor('github', 'openai/gpt-oss-120b', 'judge')).toBeNull(); // otro proveedor: no se manda
  });

  it('se manda en la peticion a Groq/gpt-oss y NO a otros modelos', async () => {
    const env = { GROQ_API_KEY: 'g' };
    const a = recorder(() => ok());
    await callCandidate({ provider: 'groq', model: 'openai/gpt-oss-120b' }, { task: 'judge', prompt: 'x' }, env, a.f);
    expect(a.bodies[0].reasoning_effort).toBe('low');
    const b = recorder(() => ok());
    await callCandidate({ provider: 'groq', model: 'qwen/qwen3.8-27b' }, { task: 'judge', prompt: 'x' }, env, b.f);
    expect(b.bodies[0].reasoning_effort).toBeUndefined();
  });

  it('si el modelo rechaza reasoning_effort (400), reintenta sin el y conserva el modo JSON', async () => {
    const env = { GROQ_API_KEY: 'g' };
    const r = recorder((b) => (b.reasoning_effort ? err(400, '{"error":{"message":"reasoning_effort is not supported"}}') : ok('{"a":1}')));
    const out = await callCandidate({ provider: 'groq', model: 'openai/gpt-oss-120b' }, { task: 'judge', prompt: 'x', json: true }, env, r.f);
    expect(out.ok).toBe(true);
    expect(r.bodies).toHaveLength(2);
    expect(r.bodies[1].reasoning_effort).toBeUndefined();
    expect(r.bodies[1].response_format).toEqual({ type: 'json_object' });
  });

  it('si rechaza ambos (modo JSON y razonamiento), reintenta quitando uno a uno', async () => {
    const env = { GROQ_API_KEY: 'g' };
    const r = recorder((b) => (b.response_format ? err(400, 'response_format not supported') : b.reasoning_effort ? err(400, 'unknown field reasoning_effort') : ok('listo')));
    const out = await callCandidate({ provider: 'groq', model: 'openai/gpt-oss-120b' }, { task: 'judge', prompt: 'x', json: true }, env, r.f);
    expect(out).toMatchObject({ ok: true, text: 'listo' });
    expect(r.bodies).toHaveLength(3);
  });

  it('un 400 que no habla de esos parametros no se reintenta en bucle', async () => {
    const env = { GROQ_API_KEY: 'g' };
    const r = recorder(() => err(400, 'prompt too long'));
    const out = await callCandidate({ provider: 'groq', model: 'openai/gpt-oss-120b' }, { task: 'judge', prompt: 'x' }, env, r.f);
    expect(out).toMatchObject({ ok: false, kind: 'bad_request' });
    expect(r.bodies).toHaveLength(1);
  });
});

describe('cadenas por defecto', () => {
  it('Gemma (HTTP 500 en la prueba real con la llave de Gemini) no esta en ninguna cadena', () => {
    for (const chain of Object.values(DEFAULT_CHAINS)) expect(chain.some((c) => /gemma/i.test(c.model))).toBe(false);
  });
});
