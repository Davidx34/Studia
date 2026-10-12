import { classifyFailure, safeErrorMessage } from '@/lib/ai/gateway/client';
import type { FailureKind } from '@/lib/ai/gateway/types';
import { embedWithGemini, l2Normalize } from './embed';
import { resolveEmbedBaseUrl, type EmbedProvider, type EmbedRole } from './providers';

type Env = Record<string, string | undefined>;

export type EmbedBatchOutcome =
  | { ok: true; vectors: number[][] }
  | { ok: false; kind: FailureKind; status?: number; retryAfterMs?: number; message?: string };

const TIMEOUT_MS = 60_000;

// Mismo mapeo de fallos que la pasarela de texto: el cortacircuito distingue "por minuto" de "cuota diaria".
function geminiKind(k: 'no_key' | 'empty' | 'quota' | 'rate' | 'server' | 'bad_response'): FailureKind {
  return { no_key: 'auth', empty: 'bad_request', quota: 'rate_daily', rate: 'rate_minute', server: 'server', bad_response: 'unparseable' }[k] as FailureKind;
}

// URL y cuerpo de la peticion segun la API del proveedor.
function requestFor(p: EmbedProvider, base: string, texts: string[], role: EmbedRole): { url: string; body: unknown } {
  switch (p.api) {
    case 'voyage':
      return { url: `${base}/embeddings`, body: { input: texts, model: p.model, input_type: role === 'query' ? 'query' : 'document', output_dimension: p.dims } };
    case 'jina':
      return { url: `${base}/embeddings`, body: { model: p.model, task: role === 'query' ? 'retrieval.query' : 'retrieval.passage', dimensions: p.dims, input: texts } };
    case 'openai':
    default:
      return { url: `${base}/embeddings`, body: { model: p.model, input: texts, encoding_format: 'float' } };
  }
}

// Embebe un LOTE (hasta p.maxBatch textos) con un proveedor. Nunca lanza. Valida cantidad y dimensiones y NORMALIZA (L2).
export async function embedBatch(p: EmbedProvider, texts: string[], role: EmbedRole, env: Env = process.env, doFetch: typeof fetch = fetch): Promise<EmbedBatchOutcome> {
  if (texts.length === 0) return { ok: true, vectors: [] };
  if (texts.length > p.maxBatch) return { ok: false, kind: 'bad_request' };

  // Gemini (nivel gratuito): sin lotes, una llamada por texto, con su propio cliente.
  if (p.api === 'gemini') {
    const vectors: number[][] = [];
    for (const t of texts) {
      const r = await embedWithGemini(t, role === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', { apiKey: env[p.keyEnv], fetchImpl: doFetch });
      if (!r.ok) return { ok: false, kind: geminiKind(r.kind), status: r.status };
      vectors.push(r.values);
    }
    return { ok: true, vectors };
  }

  const base = resolveEmbedBaseUrl(p, env);
  if (!base) return { ok: false, kind: 'auth' };

  try {
    const req = requestFor(p, base, texts, role);
    const res = await doFetch(req.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env[p.keyEnv]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const f = classifyFailure(res.status, body, res.headers.get('retry-after'));
      return { ok: false, kind: f.kind, status: res.status, retryAfterMs: f.retryAfterMs, message: safeErrorMessage(body) };
    }
    const json: any = await res.json();
    // OpenAI / Voyage / Jina: { data: [{ embedding, index }] }. Cloudflare a veces responde { result: { data: [[...]] } }.
    let rows: number[][] | null = null;
    if (Array.isArray(json?.data)) {
      const sorted = [...json.data].sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0));
      rows = sorted.map((d: any) => d?.embedding);
    } else if (Array.isArray(json?.result?.data)) {
      rows = json.result.data;
    }
    if (!rows || rows.length !== texts.length) return { ok: false, kind: 'unparseable' };
    if (!rows.every((v) => Array.isArray(v) && v.length === p.dims && v.every((x) => typeof x === 'number'))) return { ok: false, kind: 'unparseable' };
    return { ok: true, vectors: rows.map((v) => l2Normalize(v)) };
  } catch (e: any) {
    return { ok: false, kind: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'server' };
  }
}
