// Limite de uso de las rutas de IA, POR PROFESOR y por ruta, con VARIAS ventanas a la vez (por minuto, por hora, por dia). Cada pasada de la memoria o cada diseño de laboratorio gasta
// cuota de los proveedores de IA: sin tope, un profesor (o una sesion robada) podia agotarla para todos repitiendo la peticion.
//
// El contador vive en Postgres (migracion 080, consume_ai_quota): en Vercel cada instancia serverless tiene su propia memoria y se reinicia en frio, asi que un contador en memoria no
// limita nada de verdad. Si la base no responde (o la migracion aun no esta aplicada) se usa un contador en memoria de RESPALDO, por instancia: protege menos, pero nunca deja la ruta
// sin ningun tope ni la rompe. La funcion es pura salvo por la llamada que se le inyecta (rpc) y el reloj; sin red propia.

export interface QuotaRule {
  // Largo de la ventana en segundos (ventana FIJA: 60 = "por minuto").
  seconds: number;
  limit: number;
}

export interface QuotaPolicy {
  // Nombre de la ruta en la tabla de contadores: minusculas, digitos, '_', '.', '-' (lo valida la base).
  bucket: string;
  rules: readonly QuotaRule[];
}

// Topes elegidos para el piloto (un profesor real usa estas rutas unas pocas veces al dia; los topes dejan margen sin permitir el abuso):
//  - memoria: una "pasada" lee varios bloques con IA; la cadena automatica del panel encadena hasta 12 pasadas seguidas por clic -> 6 por minuto y 40 por hora lo permiten.
//  - diseño: cada peticion hace de 2 a 4 llamadas a la IA -> 3 por minuto, 20 por hora, 80 por dia.
export const QUOTA_POLICIES = {
  memoryBuild: {
    bucket: 'memory.build',
    rules: [
      { seconds: 60, limit: 6 },
      { seconds: 3600, limit: 40 },
      { seconds: 86400, limit: 150 },
    ],
  },
  blueprintGenerate: {
    bucket: 'blueprint.gen',
    rules: [
      { seconds: 60, limit: 2 },
      { seconds: 3600, limit: 12 },
      { seconds: 86400, limit: 40 },
    ],
  },
  labDesign: {
    bucket: 'lab.design',
    rules: [
      { seconds: 60, limit: 3 },
      { seconds: 3600, limit: 20 },
      { seconds: 86400, limit: 80 },
    ],
  },
} as const satisfies Record<string, QuotaPolicy>;

export type QuotaSource = 'db' | 'memory';

export type QuotaDecision = { allowed: true; source: QuotaSource } | { allowed: false; retryAfterSeconds: number; source: QuotaSource };

export type QuotaRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

// Contador de respaldo en memoria: ventana fija por (usuario, ruta, segundos).
export interface MemoryCounters {
  windows: Map<string, { start: number; hits: number }>;
}
export const sharedMemoryCounters: MemoryCounters = { windows: new Map() };

export interface QuotaDeps {
  now?: () => number;
  memory?: MemoryCounters;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
}

const MAX_MEMORY_KEYS = 5000;

function startOf(nowMs: number, seconds: number): number {
  return Math.floor(nowMs / 1000 / seconds) * seconds * 1000;
}

// Mismo contrato que la funcion SQL: se comprueban TODAS las ventanas y solo si ninguna esta llena se suma 1 a todas. Rechazar no consume.
export function consumeInMemory(userId: string, policy: QuotaPolicy, counters: MemoryCounters, nowMs: number): QuotaDecision {
  let retry = 0;
  for (const rule of policy.rules) {
    const key = `${userId}|${policy.bucket}|${rule.seconds}`;
    const start = startOf(nowMs, rule.seconds);
    const cur = counters.windows.get(key);
    const hits = cur && cur.start === start ? cur.hits : 0;
    if (hits >= rule.limit) retry = Math.max(retry, Math.max(1, Math.ceil((start + rule.seconds * 1000 - nowMs) / 1000)));
  }
  if (retry > 0) return { allowed: false, retryAfterSeconds: retry, source: 'memory' };
  for (const rule of policy.rules) {
    const key = `${userId}|${policy.bucket}|${rule.seconds}`;
    const start = startOf(nowMs, rule.seconds);
    const cur = counters.windows.get(key);
    counters.windows.set(key, cur && cur.start === start ? { start, hits: cur.hits + 1 } : { start, hits: 1 });
  }
  // Sin cron: se podan las ventanas ya vencidas cuando el mapa crece demasiado.
  if (counters.windows.size > MAX_MEMORY_KEYS) {
    counters.windows.forEach((v, k) => {
      const secs = Number(k.split('|')[2]);
      if (v.start + secs * 1000 < nowMs) counters.windows.delete(k);
    });
  }
  return { allowed: true, source: 'memory' };
}

// Lo que devuelve la funcion SQL, validado: nada de lo que vuelva de fuera se usa sin comprobar su forma.
export function parseQuotaResult(data: unknown): { allowed: boolean; retryAfterSeconds: number } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.allowed !== 'boolean') return null;
  const retry = typeof d.retry_after === 'number' && Number.isFinite(d.retry_after) ? Math.max(0, Math.round(d.retry_after)) : 0;
  return { allowed: d.allowed, retryAfterSeconds: d.allowed ? 0 : Math.max(1, retry) };
}

// Consume un cupo de `policy` para `userId`. Primero la base (atomico y compartido entre instancias); si falla, el respaldo en memoria. Nunca lanza.
export async function consumeQuota(rpc: QuotaRpc, userId: string, policy: QuotaPolicy, deps: QuotaDeps = {}): Promise<QuotaDecision> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((msg: string, detail?: Record<string, unknown>) => console.warn(msg, detail ?? ''));
  try {
    const { data, error } = await rpc('consume_ai_quota', { p_user: userId, p_bucket: policy.bucket, p_limits: policy.rules });
    if (!error) {
      const parsed = parseQuotaResult(data);
      if (parsed) return parsed.allowed ? { allowed: true, source: 'db' } : { allowed: false, retryAfterSeconds: parsed.retryAfterSeconds, source: 'db' };
      log('[AI_QUOTA_DEGRADED] respuesta inesperada de consume_ai_quota; se usa el limite en memoria', { bucket: policy.bucket });
    } else {
      // El mensaje de la base no incluye datos del usuario; igual se recorta.
      log('[AI_QUOTA_DEGRADED] consume_ai_quota fallo; se usa el limite en memoria', { bucket: policy.bucket, error: String(error.message ?? '').slice(0, 120) });
    }
  } catch (e) {
    log('[AI_QUOTA_DEGRADED] consume_ai_quota lanzo; se usa el limite en memoria', { bucket: policy.bucket, error: String((e as Error)?.message ?? e).slice(0, 120) });
  }
  return consumeInMemory(userId, policy, deps.memory ?? sharedMemoryCounters, now());
}

// "3 minutos", "45 segundos", "2 horas": para decirle al profesor cuanto esperar.
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} ${s === 1 ? 'segundo' : 'segundos'}`;
  if (s < 3600) {
    const m = Math.ceil(s / 60);
    return `${m} ${m === 1 ? 'minuto' : 'minutos'}`;
  }
  const h = Math.ceil(s / 3600);
  return `${h} ${h === 1 ? 'hora' : 'horas'}`;
}

// Cuerpo de la respuesta 429 (la ruta le pone el encabezado Retry-After con retryAfterSeconds).
export function quotaDeniedBody(retryAfterSeconds: number, what: string): { error: string; reason: 'rate_limited'; retryAfterSeconds: number } {
  return {
    error: `Has pedido ${what} muchas veces seguidas. Para cuidar el uso de la IA de todos, espera ${formatWait(retryAfterSeconds)} e inténtalo de nuevo.`,
    reason: 'rate_limited',
    retryAfterSeconds: Math.max(1, Math.round(retryAfterSeconds)),
  };
}
