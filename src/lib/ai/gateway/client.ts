import { callOpenRouter } from '@/lib/ai/openrouter';
import { providerById, resolveBaseUrl, type ProviderDef } from './providers';
import type { CallOutcome, CallRequest, Candidate, FailureKind } from './types';

type Env = Record<string, string | undefined>;

// Clasifica una respuesta HTTP no exitosa. El 429 se separa en "por minuto" (esperar sirve) y "diaria" (no sirve hasta el
// reinicio): el texto del cuerpo es lo unico que los distingue entre proveedores.
export function classifyFailure(status: number, body: string, retryAfter?: string | null): { kind: FailureKind; retryAfterMs?: number } {
  const retryAfterMs = (() => {
    const n = Number(retryAfter);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : undefined;
  })();
  if (status === 429) {
    const daily = /per.?day|daily|tokens per day|requests per day|\bRPD\b|\bTPD\b|quota.*(exceed|exhaust)|exceeded.*quota/i.test(body);
    // Un Retry-After de horas tambien delata una cuota diaria.
    if (daily || (retryAfterMs ?? 0) > 15 * 60_000) return { kind: 'rate_daily', retryAfterMs };
    return { kind: 'rate_minute', retryAfterMs };
  }
  if (status === 402) return { kind: 'payment' };
  if (status === 401 || status === 403) return { kind: 'auth' };
  if (status === 404) return { kind: 'not_found' };
  if (status === 408) return { kind: 'timeout' };
  if (status >= 500) return { kind: 'server' };
  return { kind: 'bad_request' };
}

const DEFAULT_TIMEOUT_MS = 90_000;

async function once(p: ProviderDef, base: string, model: string, req: CallRequest, env: Env, doFetch: typeof fetch, withJson: boolean): Promise<Response> {
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
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? (req.task === 'generation' || req.task === 'study' ? 0.7 : 0),
      ...(withJson ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}

// Una llamada a un candidato. Nunca lanza: todo fallo vuelve como { ok: false, kind }.
export async function callCandidate(c: Candidate, req: CallRequest, env: Env = process.env, doFetch: typeof fetch = fetch): Promise<CallOutcome> {
  const p = providerById(c.provider);
  if (!p) return { ok: false, kind: 'not_found' };

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
    let res = await once(p, base, c.model, req, env, doFetch, withJson);
    // Algunos modelos no aceptan el modo JSON: se reintenta UNA vez sin el.
    if (res.status === 400 && withJson) {
      const t = await res.clone().text();
      if (/response_format|json_object|json mode|json_schema/i.test(t)) {
        withJson = false;
        res = await once(p, base, c.model, req, env, doFetch, false);
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const f = classifyFailure(res.status, body, res.headers.get('retry-after'));
      return { ok: false, kind: f.kind, status: res.status, retryAfterMs: f.retryAfterMs };
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
