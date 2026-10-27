// Llamada DIRECTA a Gemini (API nativa generateContent) con respaldo entre modelos. La usan el juez, la lectura de PDFs, el resumen de
// fragmentos y la deteccion de temas: antes cada una tenia su propia copia con UN solo modelo, y un modelo retirado (HTTP 404) las
// dejaba sin servicio. Caso real (2026-10-26): con una llave nueva, gemini-2.5-flash y gemini-2.5-flash-lite dan 404 "ya no disponible
// para usuarios nuevos" aunque la lista de modelos los muestre.
//
// Que garantiza (y que NO):
//   - Un modelo que no existe o no esta disponible (404/403) se SALTA y se prueba el siguiente; se recuerda unas horas para no pedirlo
//     de nuevo, y se avisa UNA vez en el log del servidor.
//   - Cuota diaria agotada de un modelo (cuota POR MODELO) -> se prueba otro; 429 por minuto, 5xx y timeout -> reintento con espera y,
//     si persiste, el siguiente modelo.
//   - Un ajuste de "pensar" que el modelo rechaza (400 "thinking") se reintenta SIN el ajuste.
//   - Si TODO falla, la respuesta dice por que (reason) y nunca inventa texto: quien llama decide (el juez deja la pregunta en revision
//     humana; nunca aprueba por omision).
//   NO garantiza que la respuesta sea correcta: eso lo vigilan la validacion de cada llamador y el banco de evaluaciones.
//
// Los modelos salen de geminiModels.ts (perfil + variables) y, DESPUES, de una cola de respaldo conocida (GEMINI_MODEL_FALLBACKS; el valor
// `none` la desactiva). Asi una configuracion desactualizada sigue funcionando.

import { geminiModels, thinkingConfigFor, type GeminiRole } from './geminiModels';

type Env = Record<string, string | undefined>;

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export type GeminiFailure = 'no_key' | 'auth' | 'quota_daily' | 'rate_limited' | 'server' | 'timeout' | 'bad_request' | 'model_unavailable' | 'empty';

export interface GeminiAttempt {
  model: string;
  kind: 'ok' | GeminiFailure | 'skipped';
  status?: number;
}

export type GeminiOutcome =
  | { ok: true; text: string; model: string; usage: { prompt?: number; output?: number; thinking?: number }; attempts: GeminiAttempt[] }
  | { ok: false; reason: GeminiFailure; status?: number; attempts: GeminiAttempt[] };

// Cola de respaldo por defecto: modelos que respondieron con la llave del proyecto el 2026-10-26.
export const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];

const list = (raw: string | undefined): string[] =>
  (raw ?? '').split(',').map((m) => m.trim()).filter(Boolean);

export function fallbackModels(env: Env = process.env): string[] {
  const raw = env.GEMINI_MODEL_FALLBACKS;
  if (raw?.trim().toLowerCase() === 'none') return [];
  const fromEnv = list(raw);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_FALLBACK_MODELS;
}

// Orden de prueba: primero lo configurado para el papel, despues el respaldo; sin repetir.
export function modelChain(role: GeminiRole, env: Env = process.env): string[] {
  return Array.from(new Set([...geminiModels(role, env), ...fallbackModels(env)]));
}

// Que significa cada respuesta HTTP. Pura, para poder probarla.
export function classifyGeminiHttp(status: number, body: string): GeminiFailure {
  if (status === 429) return /PerDay/i.test(body) ? 'quota_daily' : 'rate_limited';
  if (status === 404 || status === 403) return 'model_unavailable';
  if (status === 401) return 'auth';
  if (status >= 500) return 'server';
  return 'bad_request';
}

// Memoria de modelos que no sirven. Un 404 dura horas (el modelo fue retirado); un 403 o la cuota diaria, minutos.
const TTL_MS: Partial<Record<GeminiFailure, number>> = { model_unavailable: 6 * 3600_000, quota_daily: 10 * 60_000 };
const FORBIDDEN_TTL_MS = 10 * 60_000;
const blocked = new Map<string, { until: number; kind: GeminiFailure }>();
const warned = new Set<string>();

export function resetGeminiHealth(): void {
  blocked.clear();
  warned.clear();
}

// Para mostrar en el panel de desarrollo.
export function geminiHealthSnapshot(now: number = Date.now()): { model: string; kind: GeminiFailure; minutesLeft: number }[] {
  return Array.from(blocked.entries())
    .filter(([, v]) => v.until > now)
    .map(([model, v]) => ({ model, kind: v.kind, minutesLeft: Math.ceil((v.until - now) / 60_000) }));
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

export interface GeminiRequest {
  role: GeminiRole;
  parts: unknown[];
  generationConfig?: Record<string, unknown>;
  // 'off' (por defecto): se apaga el "pensar" con el ajuste que corresponde a cada modelo. 'default': no se envia ajuste.
  thinking?: 'off' | 'default';
  // Reintentos por 429 de minuto, 5xx y timeout, solo para el primer modelo; los de respaldo reintentan una vez como maximo.
  retries?: number;
  timeoutMs?: number;
  // Con cuantos modelos se insiste si el error es "la peticion no vale" (400/413...): por defecto 2; 1 para una peticion pesada (un PDF).
  maxBadRequestModels?: number;
  models?: string[];
  apiKey?: string;
  env?: Env;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const backoffMs = (attempt: number): number => 2500 * (attempt + 1) + Math.floor(Math.random() * 500);

// Si un lote ya fallo con 2 modelos por "la peticion no vale", otro modelo no lo arreglara: no se gasta mas.
const DEFAULT_MAX_BAD_REQUEST_MODELS = 2;

export async function geminiGenerate(req: GeminiRequest): Promise<GeminiOutcome> {
  const env = req.env ?? process.env;
  const key = req.apiKey ?? env.GEMINI_API_KEY;
  const attempts: GeminiAttempt[] = [];
  if (!key) return { ok: false, reason: 'no_key', attempts };

  const doFetch = req.fetchImpl ?? fetch;
  const now = req.now ?? Date.now;
  const sleep = req.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const models = req.models ?? modelChain(req.role, env);
  const failures: { kind: GeminiFailure; status?: number }[] = [];
  let badRequests = 0;

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const block = blocked.get(model);
    if (block && block.until > now()) {
      attempts.push({ model, kind: 'skipped' });
      failures.push({ kind: block.kind });
      continue;
    }

    const maxRetries = mi === 0 ? (req.retries ?? 2) : Math.min(req.retries ?? 2, 1);
    let withThinking = (req.thinking ?? 'off') === 'off';
    let last: { kind: GeminiFailure; status?: number } = { kind: 'server' };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const thinkingCfg = withThinking ? thinkingConfigFor(model) : {};
      let res: Response;
      try {
        res = await doFetch(`${BASE_URL}/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: req.parts }], generationConfig: { ...(req.generationConfig ?? {}), ...thinkingCfg } }),
          signal: AbortSignal.timeout(req.timeoutMs ?? 120_000),
        });
      } catch (e: any) {
        last = { kind: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'server' };
        if (attempt < maxRetries) await sleep(backoffMs(attempt));
        continue;
      }

      if (res.ok) {
        const data: any = await res.json().catch(() => null);
        const text: string = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
        if (!text.trim()) {
          last = { kind: 'empty', status: 200 };
          break; // respuesta vacia: otro modelo tiene mas posibilidades que repetir
        }
        attempts.push({ model, kind: 'ok', status: 200 });
        if (mi > 0) {
          const first = attempts.find((a) => a.kind !== 'ok');
          warnOnce(`fallback:${req.role}:${model}`, `[GEMINI] ${req.role}: se uso ${model} porque ${first?.model ?? models[0]} no respondio (${first?.kind === 'skipped' ? 'descartado antes: no disponible' : (first?.kind ?? 'error')})`);
        }
        const u = data?.usageMetadata ?? {};
        return { ok: true, text, model, usage: { prompt: u.promptTokenCount, output: u.candidatesTokenCount, thinking: u.thoughtsTokenCount }, attempts };
      }

      const body = await res.text().catch(() => '');
      // Un ajuste de "pensar" que este modelo rechaza: se reintenta una vez SIN el ajuste (no cuenta como reintento).
      if (res.status === 400 && withThinking && Object.keys(thinkingCfg).length > 0 && /thinking/i.test(body)) {
        withThinking = false;
        attempt--;
        continue;
      }

      const kind = classifyGeminiHttp(res.status, body);
      last = { kind, status: res.status };
      if (kind === 'auth') {
        attempts.push({ model, kind, status: res.status });
        return { ok: false, reason: 'auth', status: res.status, attempts };
      }
      if ((kind === 'rate_limited' || kind === 'server') && attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      break;
    }

    attempts.push({ model, kind: last.kind, status: last.status });
    failures.push(last);
    if (last.kind === 'model_unavailable' || last.kind === 'quota_daily') {
      const ttl = last.kind === 'model_unavailable' && last.status === 403 ? FORBIDDEN_TTL_MS : TTL_MS[last.kind]!;
      blocked.set(model, { until: now() + ttl, kind: last.kind });
      if (last.kind === 'model_unavailable') warnOnce(`dead:${model}`, `[GEMINI] ${model} no esta disponible para esta llave (HTTP ${last.status ?? '?'}); se omite unas horas y se usa el siguiente. Revisa AI_PROFILE / GEMINI_MODEL_*.`);
    }
    if (last.kind === 'bad_request' && ++badRequests >= (req.maxBadRequestModels ?? DEFAULT_MAX_BAD_REQUEST_MODELS)) break;
  }

  // Causa que se reporta: lo transitorio primero (quien llama puede reintentar), despues la cuota, luego lo demas.
  const pick = (k: GeminiFailure) => failures.find((f) => f.kind === k);
  const chosen =
    pick('server') ?? pick('timeout') ?? pick('rate_limited') ?? pick('quota_daily') ?? pick('bad_request') ?? pick('model_unavailable') ?? pick('empty') ?? { kind: 'server' as GeminiFailure };
  return { ok: false, reason: chosen.kind, status: chosen.status, attempts };
}

// Prueba REAL de un modelo con la llave actual (para `npm run ai:doctor`): la lista de modelos puede decir "existe" y la llamada dar 404.
export async function probeGeminiModel(model: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; status: number; ms: number; kind?: GeminiFailure }> {
  const key = env.GEMINI_API_KEY;
  const t0 = Date.now();
  if (!key) return { ok: false, status: 0, ms: 0, kind: 'no_key' };
  try {
    const res = await fetchImpl(`${BASE_URL}/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde OK' }] }], generationConfig: { maxOutputTokens: 20, ...thinkingConfigFor(model) } }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = res.ok ? '' : await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, kind: res.ok ? undefined : classifyGeminiHttp(res.status, body) };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - t0, kind: 'timeout' };
  }
}
