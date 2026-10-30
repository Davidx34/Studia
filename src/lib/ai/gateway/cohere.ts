import type { CallOutcome, CallRequest, Candidate } from './types';
import { classifyFailure, safeErrorMessage } from './failure';

// Adaptador de Cohere (API v2 /chat). No habla el formato de OpenAI (la respuesta viene en message.content[].text), asi que tiene su
// propio adaptador; para el resto de la pasarela es un proveedor mas: entra en las cadenas, respeta el cortacircuito y se ordena por salud.
//
// Antes se llamaba a mano en tres sitios (generacion de preguntas, fichas de estudio y taxonomia de conceptos), cada uno con su propio
// reintento y sin cortacircuito: un Cohere caido se volvia a golpear en cada llamada.

type Env = Record<string, string | undefined>;

export const COHERE_ENDPOINT = 'https://api.cohere.com/v2/chat';
export const COHERE_DEFAULT_MODEL = 'c4ai-aya-expanse-32b';
// Maximo real de c4ai-aya-expanse-32b: pedir mas devuelve HTTP 400 ("max tokens must be less than or equal to 4096").
export const COHERE_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 100_000;

export const cohereCandidate = (env: Env = process.env): Candidate => ({ provider: 'cohere', model: env.COHERE_MODEL?.trim() || COHERE_DEFAULT_MODEL });

export function buildCohereBody(model: string, req: CallRequest): Record<string, unknown> {
  const messages = [
    ...(req.system ? [{ role: 'system', content: req.system }] : []),
    { role: 'user', content: req.prompt },
  ];
  return {
    model,
    messages,
    max_tokens: Math.min(req.maxTokens ?? COHERE_MAX_OUTPUT_TOKENS, COHERE_MAX_OUTPUT_TOKENS),
    // Sin temperatura explicita Cohere usa la suya (la de siempre en este proyecto): solo se envia si el llamador la pidio.
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
}

export interface CohereParsed {
  text: string;
  usage?: { prompt?: number; completion?: number };
  truncated: boolean;
}

// null = la respuesta no trae texto utilizable.
export function parseCohereResponse(data: any): CohereParsed | null {
  const parts = data?.message?.content;
  const text = Array.isArray(parts) ? parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('') : '';
  if (!text.trim()) return null;
  return {
    text,
    usage: { prompt: data?.usage?.tokens?.input_tokens, completion: data?.usage?.tokens?.output_tokens },
    truncated: data?.finish_reason === 'MAX_TOKENS',
  };
}

// Una llamada a Cohere. Nunca lanza: todo fallo vuelve como { ok: false, kind }.
export async function callCohereCandidate(c: Candidate, req: CallRequest, env: Env = process.env, doFetch: typeof fetch = fetch): Promise<CallOutcome> {
  const key = env.COHERE_API_KEY;
  if (!key) return { ok: false, kind: 'auth' };
  try {
    const res = await doFetch(COHERE_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCohereBody(c.model, req)),
      // Sin limite, un Cohere colgado bloqueaba la generacion hasta el corte de la funcion (300 s).
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const f = classifyFailure(res.status, body, res.headers.get('retry-after'));
      return { ok: false, kind: f.kind, status: res.status, retryAfterMs: f.retryAfterMs, message: safeErrorMessage(body) };
    }
    const parsed = parseCohereResponse(await res.json());
    if (!parsed) return { ok: false, kind: 'unparseable' };
    // Diagnostico honesto: una respuesta cortada por el limite de tokens no se ve igual que un JSON simplemente mal formado.
    if (parsed.truncated) console.warn('[cohere] respuesta TRUNCADA por limite de tokens (finish_reason=MAX_TOKENS)');
    return { ok: true, text: parsed.text, usage: parsed.usage };
  } catch (e: any) {
    return { ok: false, kind: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'server' };
  }
}
