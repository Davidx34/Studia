import { callOpenRouter } from '@/lib/ai/openrouter';
import { effectiveMaxTokens, reasoningEffortFor } from '@/lib/ai/thinking';
import { callCohereCandidate } from './cohere';
import { classifyFailure, safeErrorMessage } from './failure';
import { providerById, resolveBaseUrl, type ProviderDef } from './providers';
import type { CallOutcome, CallRequest, Candidate, FailureKind } from './types';

// Siguen exportandose desde aqui (los usan las pruebas y ai:doctor).
export { classifyFailure, safeErrorMessage, reasoningEffortFor };

type Env = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 90_000;

async function once(p: ProviderDef, base: string, model: string, req: CallRequest, env: Env, doFetch: typeof fetch, withJson: boolean, withReasoning: boolean): Promise<Response> {
  const effort = withReasoning ? reasoningEffortFor(p.id, model, req.task) : null;
  const messages = [
    ...(req.system ? [{ role: 'system', content: req.system }] : []),
    { role: 'user', content: req.prompt },
  ];
  return doFetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env[p.keyEnv]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: effectiveMaxTokens(req.maxTokens ?? 4096, effort),
      temperature: req.temperature ?? (req.task === 'generation' || req.task === 'study' ? 0.7 : 0),
      ...(withJson ? { response_format: { type: 'json_object' } } : {}),
      ...(effort ? { reasoning_effort: effort } : {}),
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}

// Una llamada a un candidato. Nunca lanza: todo fallo vuelve como { ok: false, kind }.
export async function callCandidate(c: Candidate, req: CallRequest, env: Env = process.env, doFetch: typeof fetch = fetch): Promise<CallOutcome> {
  const p = providerById(c.provider);
  if (!p) return { ok: false, kind: 'not_found' };

  // Cohere no habla el formato de OpenAI: adaptador propio (cohere.ts).
  if (p.id === 'cohere') return callCohereCandidate(c, req, env, doFetch);

  // OpenRouter conserva su adaptador propio (llave estatica o Vercel Connect, y su lista de respaldo interna).
  if (p.id === 'openrouter') {
    const role = req.task === 'judge' ? 'judge' : 'generation';
    const r = await callOpenRouter(req.prompt, { role, maxTokens: req.maxTokens ?? 6000, temperature: req.temperature, timeoutMs: req.timeoutMs, fetchImpl: doFetch });
    if (r.ok) return { ok: true, text: r.text };
    const kind: FailureKind =
      r.reason === 'rate_limited' ? (r.status === 402 ? 'payment' : 'rate_minute')
      : r.reason === 'unauthorized' || r.reason === 'no_key' ? 'auth'
      : r.reason === 'timeout' ? 'timeout'
      : r.reason === 'bad_request' ? 'bad_request'
      : 'server';
    return { ok: false, kind, status: r.status };
  }

  const base = resolveBaseUrl(p, env);
  if (!base) return { ok: false, kind: 'auth' };

  try {
    let withJson = !!req.json && p.jsonMode;
    let withReasoning = true;
    let res = await once(p, base, c.model, req, env, doFetch, withJson, withReasoning);
    // Algunos modelos no aceptan el modo JSON ni reasoning_effort: se reintenta sin el parametro rechazado (hasta 2 veces).
    for (let i = 0; i < 2 && res.status === 400; i++) {
      const t = await res.clone().text();
      if (withJson && /response_format|json_object|json mode|json_schema/i.test(t)) withJson = false;
      else if (withReasoning && /reasoning/i.test(t)) withReasoning = false;
      else break;
      res = await once(p, base, c.model, req, env, doFetch, withJson, withReasoning);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const f = classifyFailure(res.status, body, res.headers.get('retry-after'));
      return { ok: false, kind: f.kind, status: res.status, retryAfterMs: f.retryAfterMs, message: safeErrorMessage(body) };
    }
    const data: any = await res.json();
    if (data?.error) {
      const code = Number(data.error.code) || 500;
      return { ok: false, ...classifyFailure(code, JSON.stringify(data.error)), status: code };
    }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return { ok: false, kind: 'unparseable' };
    return { ok: true, text, usage: { prompt: data?.usage?.prompt_tokens, completion: data?.usage?.completion_tokens } };
  } catch (e: any) {
    return { ok: false, kind: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'server' };
  }
}
