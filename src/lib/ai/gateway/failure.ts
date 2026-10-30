import type { FailureKind } from './types';

// Clasifica una respuesta HTTP no exitosa. El 429 se separa en "por minuto" (esperar sirve) y "diaria" (no sirve hasta el
// reinicio): el texto del cuerpo es lo unico que los distingue entre proveedores.
export function classifyFailure(status: number, body: string, retryAfter?: string | null): { kind: FailureKind; retryAfterMs?: number } {
  const retryAfterMs = (() => {
    const n = Number(retryAfter);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : undefined;
  })();
  if (status === 429) {
    // Cohere (llave de prueba) avisa "limited to 1000 API calls / month": un tope mensual tampoco se arregla esperando un minuto.
    const daily = /per.?day|daily|tokens per day|requests per day|\bRPD\b|\bTPD\b|quota.*(exceed|exhaust)|exceeded.*quota|calls\s*\/\s*month|per month|monthly/i.test(body);
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
