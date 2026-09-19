// Respaldo de proveedores de IA a traves de OpenRouter (https://openrouter.ai).
//
// Por que existe: la generacion dependia de UN solo proveedor (Cohere) y el juez de
// OTRO (Gemini, con 20 peticiones por dia en el plan gratuito). Cuando cualquiera de
// los dos falla o se agota, el profesor se queda sin preguntas o sin veredictos.
// OpenRouter da acceso a muchos modelos con una sola llave y una API compatible con
// OpenAI, asi que un respaldo es una llamada mas y no un SDK nuevo.
//
// Regla: es SOLO respaldo. Cohere sigue siendo el generador principal y Gemini el
// juez principal; OpenRouter se usa cuando ellos fallan o se agotan. Sin
// OPENROUTER_API_KEY todo se comporta exactamente como antes.
//
// Variables de entorno (Vercel):
//   OPENROUTER_API_KEY            obligatoria para activar el respaldo
//   OPENROUTER_GENERATION_MODELS  opcional, lista separada por comas, en orden de preferencia
//   OPENROUTER_JUDGE_MODELS       opcional, idem, para el juez
//
// Modelos por defecto (verificados en el catalogo publico el 2026-09-19). El juez usa
// una familia distinta de la de quien genero (Llama/GPT-4o mini frente a Aya y
// Gemini) para no juzgarse con un modelo del mismo linaje.

export type OpenRouterRole = 'generation' | 'judge';

export const DEFAULT_MODELS: Record<OpenRouterRole, string[]> = {
  generation: ['meta-llama/llama-3.3-70b-instruct', 'openai/gpt-4o-mini'],
  judge: ['openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct'],
};

const ENV_MODELS: Record<OpenRouterRole, string> = {
  generation: 'OPENROUTER_GENERATION_MODELS',
  judge: 'OPENROUTER_JUDGE_MODELS',
};

// OpenRouter acepta como maximo 3 modelos en la lista de respaldo de una peticion.
const MAX_MODELS_PER_REQUEST = 3;

export function isOpenRouterConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

export function openRouterModels(role: OpenRouterRole): string[] {
  const raw = process.env[ENV_MODELS[role]];
  const fromEnv = (raw ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return (fromEnv.length > 0 ? fromEnv : DEFAULT_MODELS[role]).slice(0, MAX_MODELS_PER_REQUEST);
}

export type OpenRouterFailure = 'no_key' | 'rate_limited' | 'server' | 'bad_request' | 'unauthorized' | 'timeout' | 'empty';

export type OpenRouterCall =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: OpenRouterFailure; status?: number };

export interface OpenRouterOptions {
  role: OpenRouterRole;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  retries?: number;
  // Inyectables para poder probarlo sin red.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export function classifyStatus(status: number): OpenRouterFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402 || status === 429) return 'rate_limited'; // 402 = sin credito: tampoco sirve reintentar de inmediato
  if (status >= 500) return 'server';
  return 'bad_request';
}

export async function callOpenRouter(prompt: string, opts: OpenRouterOptions): Promise<OpenRouterCall> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no_key' };

  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 1;
  const models = openRouterModels(opts.role);

  let last: OpenRouterCall = { ok: false, reason: 'server' };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // Identifican la app en OpenRouter (opcionales, pero recomendados por ellos).
          'HTTP-Referer': 'https://studia-theta.vercel.app',
          'X-Title': 'Stud.ia',
        },
        body: JSON.stringify({
          // `models` es la lista de respaldo propia de OpenRouter: si el primero falla,
          // prueba el siguiente dentro de la misma peticion.
          model: models[0],
          models,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: opts.maxTokens ?? 6000,
          temperature: opts.temperature ?? (opts.role === 'judge' ? 0 : 0.7),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      });

      if (!res.ok) {
        const failure = classifyStatus(res.status);
        last = { ok: false, reason: failure, status: res.status };
        // Sin permiso, peticion invalida o sin credito: reintentar no cambia nada.
        if (failure === 'unauthorized' || failure === 'bad_request' || res.status === 402) return last;
      } else {
        const data: any = await res.json();
        // OpenRouter puede responder 200 con un error dentro del cuerpo.
        if (data?.error) {
          last = { ok: false, reason: classifyStatus(Number(data.error.code) || 500), status: Number(data.error.code) || undefined };
        } else {
          const text = data?.choices?.[0]?.message?.content;
          if (typeof text === 'string' && text.trim()) return { ok: true, text, model: String(data.model ?? models[0]) };
          last = { ok: false, reason: 'empty' };
        }
      }
    } catch (e: any) {
      last = { ok: false, reason: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'server' };
    }

    if (attempt < retries) await sleep(1500 * (attempt + 1));
  }
  return last;
}
