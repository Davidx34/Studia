// Embeddings con Gemini, usados como DEBEN usarse para recuperacion:
//   - taskType: RETRIEVAL_DOCUMENT para los fragmentos del material y RETRIEVAL_QUERY para la consulta (el modelo los
//     optimiza distinto; antes ambos se calculaban "sin tipo").
//   - normalizacion L2: a menos de 3072 dimensiones el modelo NO devuelve vectores normalizados.
//   - la llave va en la cabecera x-goog-api-key, no en la URL (que acaba en logs y trazas).
//
// Un vector solo es comparable con vectores del MISMO modelo y la MISMA configuracion: por eso cada fragmento guarda su
// "perfil" en material_chunks.embedding_model (migracion 068).

export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768; // debe coincidir con material_chunks.embedding vector(768)
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Fragmentos nuevos: tipados y normalizados.
export const EMBEDDING_PROFILE = `${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:rt`;
// Los 197 fragmentos anteriores a la migracion 068: sin taskType y sin normalizar. Siguen siendo utiles (mismo modelo y
// dimensiones) hasta que `npm run reindex:embeddings` los recalcule.
export const LEGACY_EMBEDDING_PROFILE = `${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:legacy`;
// Perfiles contra los que se busca por vectores.
export const QUERYABLE_PROFILES = [EMBEDDING_PROFILE, LEGACY_EMBEDDING_PROFILE];

export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export type EmbedResult =
  | { ok: true; values: number[] }
  | { ok: false; kind: 'no_key' | 'empty' | 'quota' | 'rate' | 'server' | 'bad_response'; status?: number };

export function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

// 429 con RESOURCE_EXHAUSTED / "quota" = cuota agotada (reintentar en milisegundos no sirve); otro 429 = limite por minuto.
export function classifyEmbedFailure(status: number, body: string): 'quota' | 'rate' | 'server' | 'bad_response' {
  if (status === 429) return /RESOURCE_EXHAUSTED|quota/i.test(body) ? 'quota' : 'rate';
  if (status >= 500) return 'server';
  return 'bad_response';
}

export interface EmbedOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  // null = sin taskType (solo para reproducir el comportamiento anterior en las evaluaciones).
  normalize?: boolean;
}

export async function embedWithGemini(text: string, task: EmbedTask | null, opts: EmbedOptions = {}): Promise<EmbedResult> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, kind: 'no_key' };
  if (!text?.trim()) return { ok: false, kind: 'empty' };

  try {
    const res = await (opts.fetchImpl ?? fetch)(`${GEMINI_BASE_URL}/models/${EMBEDDING_MODEL}:embedContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
        ...(task ? { taskType: task } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, kind: classifyEmbedFailure(res.status, await res.text().catch(() => '')), status: res.status };
    const json: any = await res.json();
    const values = json?.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) return { ok: false, kind: 'bad_response' };
    return { ok: true, values: opts.normalize === false ? values : l2Normalize(values) };
  } catch {
    return { ok: false, kind: 'server' };
  }
}

// Embedding de una CONSULTA. null ante cualquier falla: el llamador sigue con la busqueda por texto.
export async function embedQuery(text: string, opts: EmbedOptions = {}): Promise<number[] | null> {
  const r = await embedWithGemini(text, 'RETRIEVAL_QUERY', opts);
  return r.ok ? r.values : null;
}
