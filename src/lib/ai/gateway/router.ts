import { callCandidate } from './client';
import { HealthTracker, keyOf, sharedHealth } from './health';
import { chainFor } from './providers';
import type { AiTask, Attempt, CallRequest, Candidate, RouteResult } from './types';

type Env = Record<string, string | undefined>;

export interface RouteOptions<T> {
  task: AiTask;
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
  // Convierte el texto en el valor que el llamador quiere y dice cuanto sirve (0..1). null = no es utilizable.
  // Una respuesta que no pasa la validacion cuenta como fallo y se prueba el siguiente candidato.
  validate?: (text: string) => { value: T; quality: number } | null;
  // Desde que calidad se acepta sin seguir probando (por defecto 1). Con menos, se guarda la mejor y se sigue.
  acceptQuality?: number;
  maxAttempts?: number;
  // Proveedores que NO se deben usar en esta llamada (p. ej. el que ya fallo antes de llegar aqui).
  exclude?: string[];
  chain?: Candidate[];
  deps?: { env?: Env; fetchImpl?: typeof fetch; health?: HealthTracker; now?: () => number };
}

// Manda una tarea de texto a la cadena de proveedores: respeta el cortacircuito, ordena por salud, valida la salida y, si un
// candidato falla o responde mal, pasa al siguiente. Nunca lanza.
export async function routeText<T = string>(opts: RouteOptions<T>): Promise<RouteResult<T>> {
  const env = opts.deps?.env ?? process.env;
  const health = opts.deps?.health ?? sharedHealth;
  const now = opts.deps?.now ?? Date.now;
  const excluded = new Set(opts.exclude ?? []);

  const chain = (opts.chain ?? chainFor(opts.task, env)).filter((c) => !excluded.has(c.provider));
  if (chain.length === 0) return { ok: false, reason: 'no_providers', attempts: [] };

  const ranked = health.rank(chain);
  if (ranked.length === 0) return { ok: false, reason: 'all_unavailable', attempts: [] };

  const accept = opts.acceptQuality ?? 1;
  const maxAttempts = opts.maxAttempts ?? 4;
  const attempts: Attempt[] = [];
  let best: { value: T; text: string; provider: string; model: string; quality: number } | null = null;

  const req: CallRequest = {
    task: opts.task,
    prompt: opts.prompt,
    system: opts.system,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    json: opts.json,
    timeoutMs: opts.timeoutMs,
  };

  for (const cand of ranked.slice(0, maxAttempts)) {
    const t0 = now();
    const out = await callCandidate(cand, req, env, opts.deps?.fetchImpl);
    const ms = now() - t0;

    if (!out.ok) {
      health.failure(cand, out.kind, out.retryAfterMs);
      attempts.push({ provider: cand.provider, model: cand.model, ok: false, kind: out.kind, status: out.status, ms });
      continue;
    }

    const checked = opts.validate ? opts.validate(out.text) : { value: out.text as unknown as T, quality: 1 };
    if (!checked) {
      health.failure(cand, 'unparseable');
      attempts.push({ provider: cand.provider, model: cand.model, ok: false, kind: 'unparseable', ms });
      continue;
    }

    health.success(cand, ms);
    // Con AI_LOG_USAGE=1 cada respuesta deja una linea en el log del servidor (tarea, modelo, tiempo y tokens; nunca el contenido):
    // sirve para medir el costo real por modulo cuando se prueba un modelo de pago. Apagado por defecto.
    if (env.AI_LOG_USAGE === '1') console.log(formatUsageLine(opts.task, cand, ms, out.usage));
    attempts.push({ provider: cand.provider, model: cand.model, ok: true, ms });
    const candidate = { value: checked.value, text: out.text, provider: cand.provider, model: cand.model, quality: checked.quality };
    if (!best || candidate.quality > best.quality) best = candidate;
    if (checked.quality >= accept) break;
  }

  if (best) return { ok: true, ...best, attempts };
  return { ok: false, reason: 'exhausted', attempts };
}

// Una linea de uso por llamada exitosa (ver AI_LOG_USAGE). Sin datos del usuario ni del material.
export function formatUsageLine(task: string, cand: Candidate, ms: number, usage?: { prompt?: number; completion?: number }): string {
  return `[AI_USAGE] task=${task} model=${cand.provider}/${cand.model} ms=${ms} in=${usage?.prompt ?? '?'} out=${usage?.completion ?? '?'}`;
}

// Resumen legible de lo ocurrido, para registrar en el log del servidor (sin datos del usuario ni llaves).
export function describeAttempts(attempts: Attempt[]): string {
  return attempts.map((a) => `${keyOf(a)}=${a.ok ? 'ok' : a.kind}${a.status ? `(${a.status})` : ''}@${a.ms}ms`).join(' > ') || '(sin intentos)';
}
