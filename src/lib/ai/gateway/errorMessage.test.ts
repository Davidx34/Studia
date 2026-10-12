import { describe, it, expect } from 'vitest';
import { safeErrorMessage, callCandidate } from './client';
import { embedBatch } from '@/lib/embeddings/client';
import { embedChain } from '@/lib/embeddings/providers';

describe('motivo legible de un fallo (ai:doctor)', () => {
  it('extrae el mensaje de las formas habituales de error', () => {
    expect(safeErrorMessage('{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}')).toBe('Authentication error');
    expect(safeErrorMessage('{"error":{"message":"The model does not exist","type":"invalid_request_error"}}')).toBe('The model does not exist');
    expect(safeErrorMessage('{"message":"Invalid API Key"}')).toBe('Invalid API Key');
    expect(safeErrorMessage('{"error":"quota exceeded"}')).toBe('quota exceeded');
    expect(safeErrorMessage('Bad Gateway')).toBe('Bad Gateway');
    expect(safeErrorMessage('')).toBeUndefined();
  });

  it('nunca deja pasar una credencial larga ni un mensaje enorme', () => {
    const token = 'cfut_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const out = safeErrorMessage(`{"errors":[{"message":"Invalid token ${token} for user"}]}`)!;
    expect(out).not.toContain('AbCdEfGhIj');
    expect(out).toContain('[…]');
    expect(safeErrorMessage('x '.repeat(500))!.length).toBeLessThanOrEqual(140);
  });

  it('el fallo de un proveedor de texto lleva el motivo', async () => {
    const f = (async () => new Response('{"errors":[{"message":"Invalid API Token"}]}', { status: 401 })) as unknown as typeof fetch;
    const r = await callCandidate({ provider: 'groq', model: 'm' }, { task: 'judge', prompt: 'x' }, { GROQ_API_KEY: 'k' }, f);
    expect(r).toMatchObject({ ok: false, kind: 'auth', status: 401, message: 'Invalid API Token' });
  });

  it('el fallo de un proveedor de embeddings lleva el motivo (Cloudflare 401)', async () => {
    const env = { CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: 'a' };
    const p = embedChain(env)[0];
    const f = (async () => new Response('{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}', { status: 401 })) as unknown as typeof fetch;
    expect(await embedBatch(p, ['a'], 'document', env, f)).toMatchObject({ ok: false, kind: 'auth', status: 401, message: 'Authentication error' });
  });
});
