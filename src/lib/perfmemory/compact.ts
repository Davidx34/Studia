// Memoria de rendimiento del sistema: convierte un resumen de k6 (`--summary-export`) en un registro COMPACTO y estable que una persona o una IA puede comparar con corridas anteriores.
// Codigo puro (sin disco ni red); lo usa scripts/perf-record.ts y lo prueba vitest. Nunca guarda credenciales: solo metricas y los metadatos que se le pasan.

export type Timing = { avg?: number; med?: number; p90?: number; p95?: number; max?: number };
export type RunMeta = { id: string; date: string; target: string; scenario: string; profile: string; note?: string };
export type RunRecord = RunMeta & {
  vusMax: number | null;
  http: { requests: number | null; perSecond: number | null; failedRate: number | null };
  checks: { passes: number; fails: number } | null;
  thresholdsFailed: string[];
  timings: Record<string, Timing>; // por etiqueta (p. ej. "lesson_answer") en milisegundos
  counters: Record<string, number>; // contadores propios del escenario (lessons_finished, unexpected_generation...)
};

type Metric = Record<string, any>;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined);

// Contadores conocidos de los escenarios (los de k6 como iterations o data_sent no interesan).
const COUNTERS = ['lessons_finished', 'lesson_locked', 'unexpected_generation', 'login_failures', 'questions_skipped_unsupported_type', 'iterations'];

export function compactSummary(summary: { metrics?: Record<string, Metric> }, meta: RunMeta): RunRecord {
  const m = summary?.metrics ?? {};
  const timings: Record<string, Timing> = {};
  const thresholdsFailed: string[] = [];
  for (const [name, metric] of Object.entries(m)) {
    // Un umbral con `false` en el export de k6 significa que SE CUMPLIO (ok = no cruzado); `true` = cruzado.
    for (const [expr, crossed] of Object.entries((metric?.thresholds ?? {}) as Record<string, boolean>)) if (crossed === true) thresholdsFailed.push(`${name} ${expr}`);
    const tagged = /^http_req_duration\{name:([^}]+)\}$/.exec(name);
    if (tagged) {
      timings[tagged[1]] = { avg: num(metric.avg), med: num(metric.med), p90: num(metric['p(90)']), p95: num(metric['p(95)']), max: num(metric.max) };
    }
  }
  if (m.http_req_duration && Object.keys(timings).length === 0) {
    const d = m.http_req_duration;
    timings.all = { avg: num(d.avg), med: num(d.med), p90: num(d['p(90)']), p95: num(d['p(95)']), max: num(d.max) };
  }
  const counters: Record<string, number> = {};
  for (const c of COUNTERS) if (typeof m[c]?.count === 'number') counters[c] = m[c].count;
  const failedRate = m.http_req_failed ? num(m.http_req_failed.value) ?? null : null;
  return {
    ...meta,
    vusMax: num(m.vus_max?.max ?? m.vus_max?.value) ?? null,
    http: { requests: m.http_reqs?.count ?? null, perSecond: num(m.http_reqs?.rate) ?? null, failedRate },
    checks: m.checks && typeof m.checks.passes === 'number' ? { passes: m.checks.passes, fails: m.checks.fails ?? 0 } : null,
    thresholdsFailed: thresholdsFailed.sort(),
    timings,
    counters,
  };
}

// Variacion relativa entre dos mediciones (negativa = mejoro): util para el libro de optimizaciones.
export function change(before: number, after: number): { pct: number; text: string } {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return { pct: NaN, text: 'sin comparacion' };
  const pct = Math.round(((after - before) / before) * 1000) / 10;
  return { pct, text: `${pct > 0 ? '+' : ''}${pct} %` };
}
