import type { Candidate, FailureKind } from './types';

// Salud de cada candidato (proveedor:modelo): cortacircuito + estadisticas moviles para ordenar de forma ADAPTATIVA.
// Vive en memoria de la instancia (Vercel reutiliza instancias calientes): una instancia nueva empieza sin historial y
// vuelve a aprender en pocas llamadas. Reloj inyectable para probarlo.

export interface Health {
  openUntil: number; // epoch ms hasta el que se aparta el candidato
  successEma: number; // media movil de exito, 0..1 (1 = sin historial)
  latencyEma: number; // ms
  consecutiveFailures: number;
  calls: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const keyOf = (c: Candidate): string => `${c.provider}:${c.model}`;

// Cuanto se aparta un candidato segun por que fallo.
export function openForMs(kind: FailureKind, now: number, consecutive: number, retryAfterMs?: number): number {
  switch (kind) {
    case 'rate_minute':
      return Math.min(Math.max(retryAfterMs ?? 30_000, 5_000), 10 * MIN);
    case 'rate_daily': {
      // Hasta el proximo reinicio a medianoche UTC, con tope: mejor volver a probar antes que quedarse sin proveedor.
      const d = new Date(now);
      const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
      return Math.min(nextMidnight, 8 * HOUR);
    }
    case 'payment':
    case 'auth':
      return HOUR;
    case 'not_found':
      return 6 * HOUR;
    case 'server':
    case 'timeout':
      // Un solo fallo no aparta (puede ser un parpadeo); al segundo seguido si.
      return consecutive >= 2 ? Math.min(30_000 * 2 ** (consecutive - 2), 10 * MIN) : 0;
    case 'unparseable':
      return consecutive >= 3 ? 2 * MIN : 0;
    case 'bad_request':
      return 0; // es de esta peticion, no del proveedor
  }
}

export class HealthTracker {
  private readonly map = new Map<string, Health>();
  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): Health {
    let h = this.map.get(key);
    if (!h) {
      h = { openUntil: 0, successEma: 1, latencyEma: 0, consecutiveFailures: 0, calls: 0 };
      this.map.set(key, h);
    }
    return h;
  }

  isAvailable(c: Candidate): boolean {
    return this.get(keyOf(c)).openUntil <= this.now();
  }

  success(c: Candidate, ms: number): void {
    const h = this.get(keyOf(c));
    h.successEma = 0.8 * h.successEma + 0.2;
    h.latencyEma = h.calls === 0 ? ms : 0.7 * h.latencyEma + 0.3 * ms;
    h.consecutiveFailures = 0;
    h.openUntil = 0;
    h.calls++;
  }

  failure(c: Candidate, kind: FailureKind, retryAfterMs?: number): void {
    const h = this.get(keyOf(c));
    h.calls++;
    // Un bad_request no dice nada del proveedor: no ensucia su historial.
    if (kind === 'bad_request') return;
    h.successEma = 0.8 * h.successEma;
    h.consecutiveFailures++;
    const open = openForMs(kind, this.now(), h.consecutiveFailures, retryAfterMs);
    if (open > 0) h.openUntil = this.now() + open;
  }

  // Disponibles, ordenados por: preferencia de la cadena (indice) ajustada por lo bien que han respondido y su latencia.
  // Con historial limpio el orden es exactamente el de la cadena; un proveedor que falla mucho cede el puesto al siguiente.
  rank(chain: Candidate[]): Candidate[] {
    return chain
      .map((c, index) => {
        const h = this.get(keyOf(c));
        return { c, index, score: h.successEma - index * 0.08 - Math.min(h.latencyEma, 30_000) / 300_000 };
      })
      .filter(({ c }) => this.isAvailable(c))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ c }) => c);
  }

  // Borra todo el historial (pruebas y reinicio manual).
  reset(): void {
    this.map.clear();
  }

  snapshot(): Record<string, Health & { available: boolean }> {
    const out: Record<string, Health & { available: boolean }> = {};
    this.map.forEach((h, k) => {
      out[k] = { ...h, available: h.openUntil <= this.now() };
    });
    return out;
  }
}

// Instancia compartida por todo el proceso.
export const sharedHealth = new HealthTracker();
