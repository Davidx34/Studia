import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { change, compactSummary } from './compact';

const meta = { id: 'x', date: '2026-11-06', target: 'produccion', scenario: '03-lesson-flow', profile: 'aula' };
const summary = {
  metrics: {
    'http_req_duration{name:lesson_answer}': { avg: 442.2797, med: 423.2361, max: 2616.7104, 'p(90)': 531.8384, 'p(95)': 588.27898, thresholds: { 'p(95)<1000': false, 'p(99)<2500': true } },
    'http_req_duration{name:lesson_start}': { avg: 635.2, med: 610.2, max: 1890, 'p(90)': 774.7, 'p(95)': 842.1 },
    http_req_failed: { fails: 1986, passes: 0, value: 0 },
    http_reqs: { rate: 5.6156, count: 1986 },
    vus_max: { value: 20, min: 20, max: 20 },
    lessons_finished: { count: 249, rate: 0.7 },
    unexpected_generation: { count: 0, rate: 0 },
    data_received: { count: 99999 },
    checks: { passes: 2484, fails: 0, value: 1 },
  },
};

describe('compactSummary', () => {
  const r = compactSummary(summary, meta);
  it('extrae los tiempos por etiqueta, redondeados', () => {
    expect(r.timings.lesson_answer).toEqual({ avg: 442.28, med: 423.24, p90: 531.84, p95: 588.28, max: 2616.71 });
    expect(Object.keys(r.timings).sort()).toEqual(['lesson_answer', 'lesson_start']);
  });
  it('un umbral en true (cruzado) se lista; en false (cumplido) no', () => {
    expect(r.thresholdsFailed).toEqual(['http_req_duration{name:lesson_answer} p(99)<2500']);
  });
  it('http, vus, comprobaciones y solo los contadores conocidos', () => {
    expect(r.vusMax).toBe(20);
    expect(r.http).toEqual({ requests: 1986, perSecond: 5.62, failedRate: 0 });
    expect(r.checks).toEqual({ passes: 2484, fails: 0 });
    expect(r.counters).toEqual({ lessons_finished: 249, unexpected_generation: 0 });
    expect(JSON.stringify(r)).not.toContain('data_received');
  });
  it('conserva los metadatos y tolera un resumen vacio o sin etiquetas', () => {
    expect(r).toMatchObject(meta);
    const e = compactSummary({}, meta);
    expect(e).toMatchObject({ vusMax: null, checks: null, timings: {}, thresholdsFailed: [] });
    const plain = compactSummary({ metrics: { http_req_duration: { avg: 10, med: 9, max: 20, 'p(90)': 15, 'p(95)': 18 } } }, meta);
    expect(plain.timings.all.p95).toBe(18);
  });
});

describe('change', () => {
  it('variacion relativa (negativa = mejoro)', () => {
    expect(change(2.66, 1.48)).toEqual({ pct: -44.4, text: '-44.4 %' });
    expect(change(1, 1.5).text).toBe('+50 %');
    expect(change(0, 1).text).toBe('sin comparacion');
    expect(change(NaN, 1).text).toBe('sin comparacion');
  });
});

describe('la memoria no guarda secretos', () => {
  it('el codigo del registrador no lee users.json ni claves', () => {
    const s = fs.readFileSync(path.join(process.cwd(), 'scripts/perf-record.ts'), 'utf8');
    expect(s).not.toMatch(/users\.json|SERVICE_ROLE|password|ANON_KEY/i);
  });
});
