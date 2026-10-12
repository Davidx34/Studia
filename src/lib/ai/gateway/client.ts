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

// Motivo legible de un fallo HTTP, para diagnostico (ai:doctor): el mensaje que devuelve el proveedor ("Invalid API Token",
// "model not found"...), recortado y con cualquier cadena larga tapada por si algun proveedor repitiera una credencial.
export function safeErrorMessage(body: string): string | undefined {
  if (!body) return undefined;
  let msg = '';
  try {
    const j: any = JSON.parse(body);
    msg = String(j?.errors?.[0]?.message ?? j?.error?.message ?? j?.message ?? (typeof j?.error === 'string' ? j.error : '') ?? '');
  } catch {
    msg = body;
  }
  msg = msg.replace(/\s+/g, ' ').replace(/[A-Za-z0-9_\-.]{28,}/g, '[…]').trim().slice(0, 140);
  return msg || undefined;
}

const DEFAULT_TIMEOUT_MS = 90_000;

// Los modelos gpt-oss "piensan" antes de responder y ese razonamiento cuenta como salida: con pocos tokens la respuesta llega
// VACIA (verificado con ai:doctor --ping). Groq y Cerebras aceptan reasoning_effort: bajo para juzgar y analizar (tareas
// cortas y deterministas), medio para generar. Otros proveedores no reciben el parametro.
export function reasoningEffortFor(providerId: string, model: string, task: CallRequest['task']): 'low' | 'medium' | null {
  if (!/gpt-oss/i.test(model) || (providerId !== 'groq' && providerId !== 'cerebras')) return null;
  return task === 'generation' || task === 'study' ? 'medium' : 'low';
}

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
      max_tokens: req.maxTokens ?? 4096,
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
