// Modelos de Gemini para las Edge Functions (Deno), con respaldo entre modelos.
//
// Las funciones llamaban a Gemini con el modelo escrito a mano ('gemini-2.5-flash', e incluso 'gemini-1.5-flash', retirado). Con una
// llave de un proyecto nuevo, 2.5-flash y 2.5-flash-lite dan HTTP 404 ("ya no disponible para usuarios nuevos") y solo responden los 3.x
// (medido 2026-10-26). Esta es la version Deno de src/lib/ai/geminiModels.ts: no se puede importar de alla porque son mundos distintos.
//
// Secreto opcional (supabase secrets set GEMINI_MODELS="gemini-3.5-flash-lite,gemini-3.5-flash"): lista con comas, el primero es el
// preferido y el resto, respaldo. Sin el, se usa DEFAULT_MODELS (el modelo de siempre primero, asi nada cambia donde ya funciona).
//
// Sin dependencias de Deno (solo fetch), para poder probarlo con vitest.

export const DEFAULT_MODELS = [
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
];

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export function parseModels(raw: string | undefined | null): string[] {
  const models = (raw ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return models.length > 0 ? Array.from(new Set(models)) : DEFAULT_MODELS;
}

// Como se apaga el "pensar" interno, que gasta tokens de salida. Cada familia lo pide distinto y pedirlo mal da HTTP 400:
//   gemini-2.5-*            thinkingBudget: 0
//   gemini-3.5-flash        thinkingLevel: 'minimal'
//   gemini-3.5-flash-lite   nada (thinkingBudget: 0 da 400; sin parametro no piensa)
// Cualquier otro modelo: nada (siempre es valido; como mucho piensa de mas).
export function thinkingConfigFor(model: string): Record<string, unknown> {
  if (/^gemini-2\.5-/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-3\.5-flash$/.test(model)) return { thinkingConfig: { thinkingLevel: 'minimal' } };
  return {};
}

// Cuando conviene probar con otro modelo: el modelo no existe para esta llave (404, 403), cuota o saturacion (429) o fallo del
// servidor (5xx). Un 400/401 (peticion o llave mala) fallaria igual con cualquier modelo: se devuelve tal cual.
export const shouldFallback = (status: number): boolean =>
  status === 404 || status === 403 || status === 429 || status >= 500;

// Modelos que ya dieron 404/403 en este isolate: se saltan en las siguientes peticiones para no pagar un viaje perdido por llamada.
// (Un 429 o 5xx es pasajero y no se recuerda.) Si todos estan marcados, se prueban de nuevo.
const unavailable = new Set<string>();
export const resetUnavailableModels = (): void => unavailable.clear();

// Deno no existe como tipo fuera de las Edge Functions (tsc de Next, vitest): se lee por globalThis.
const denoEnv = (name: string): string | undefined =>
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name);

export interface GenerateResult {
  // deno-lint-ignore no-explicit-any
  json: any;
  model: string;
}

/**
 * POST a :generateContent probando cada modelo de la lista hasta que uno responda bien. `body` es el cuerpo ya armado (prompt y
 * generationConfig no se tocan); solo se le suma el thinkingConfig que corresponde a cada modelo. Lanza Error si ninguno responde.
 */
export async function generateContent(
  apiKey: string,
  body: { generationConfig?: Record<string, unknown>; [k: string]: unknown },
  models: string[] = parseModels(denoEnv('GEMINI_MODELS')),
  label = 'Gemini',
  fetchImpl: typeof fetch = fetch
): Promise<GenerateResult> {
  const alive = models.filter((m) => !unavailable.has(m));
  const queue = alive.length > 0 ? alive : models;
  const errors: string[] = [];

  for (const model of queue) {
    const payload = {
      ...body,
      generationConfig: { ...(body.generationConfig ?? {}), ...thinkingConfigFor(model) },
    };
    let res: Response;
    try {
      res = await fetchImpl(`${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      errors.push(`${model}: red (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    if (res.ok) return { json: await res.json(), model };

    const txt = (await res.text()).slice(0, 300);
    errors.push(`${model}: ${res.status}`);
    if (res.status === 404 || res.status === 403) unavailable.add(model);
    if (!shouldFallback(res.status)) throw new Error(`${label} falló: ${res.status} ${txt}`);
    console.warn(`${label}: ${model} respondió ${res.status}, probando el siguiente modelo`);
  }
  throw new Error(`${label} falló con todos los modelos (${errors.join('; ')})`);
}
