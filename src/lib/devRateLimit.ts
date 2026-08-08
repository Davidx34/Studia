// Rate limiting simple en memoria para /api/dev-auth.
// Mantiene un contador de intentos fallidos por IP con backoff exponencial.

interface RateLimitEntry {
  failCount: number;
  lastFailedAt: number;
  nextRetryAt: number;
}

const ipAttempts = new Map<string, RateLimitEntry>();

const CONFIG = {
  MAX_ATTEMPTS_BEFORE_BACKOFF: 5, // tras 5 fallos, empieza el backoff
  BASE_DELAY_MS: 1000, // 1s inicial
  MAX_DELAY_MS: 60000, // 1 min máximo
  CLEANUP_INTERVAL_MS: 60000, // limpiar cada minuto
};

// Limpiar intentos expirados cada cierto tiempo
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipAttempts.entries()) {
    if (now - entry.lastFailedAt > CONFIG.MAX_DELAY_MS * 10) {
      ipAttempts.delete(ip);
    }
  }
}, CONFIG.CLEANUP_INTERVAL_MS);

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : 'unknown';
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const entry = ipAttempts.get(ip);
  const now = Date.now();

  if (!entry) {
    return { allowed: true, retryAfterMs: 0 };
  }

  if (now < entry.nextRetryAt) {
    const retryAfterMs = entry.nextRetryAt - now;
    return { allowed: false, retryAfterMs };
  }

  // El tiempo de espera expiró, permitir otro intento
  return { allowed: true, retryAfterMs: 0 };
}

export function recordFailedAttempt(ip: string): number {
  const entry = ipAttempts.get(ip);
  const now = Date.now();

  if (!entry) {
    // Primer intento fallido
    ipAttempts.set(ip, {
      failCount: 1,
      lastFailedAt: now,
      nextRetryAt: now, // sin espera el primer intento
    });
    return 0;
  }

  entry.failCount += 1;
  entry.lastFailedAt = now;

  if (entry.failCount > CONFIG.MAX_ATTEMPTS_BEFORE_BACKOFF) {
    // Calcular backoff exponencial: 2^(failCount - MAX_ATTEMPTS)
    const exponentialBase = Math.pow(2, entry.failCount - CONFIG.MAX_ATTEMPTS_BEFORE_BACKOFF);
    const delayMs = Math.min(
      CONFIG.BASE_DELAY_MS * exponentialBase,
      CONFIG.MAX_DELAY_MS
    );
    entry.nextRetryAt = now + delayMs;
    return delayMs;
  }

  return 0;
}

export function clearAttempts(ip: string): void {
  ipAttempts.delete(ip);
}
