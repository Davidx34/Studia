import { describe, expect, it } from 'vitest';
import { LONG_QUEUE, monitorReport, outcomeOf, tally, watchActivePlaybook, type PlaybookVersionRow, type QuestionRow } from './regressionMonitor';
import type { Calibration } from './judgeCalibration';

const day = (d: number) => new Date(Date.UTC(2026, 9, d)).toISOString(); // octubre 2026
const q = (d: number, status: string, reason: string | null = null, by: string | null = 'ai_judge'): QuestionRow => ({ created_at: day(d), review_status: status, review_reason: reason, reviewed_by: by });
const good = (d: number, n: number) => Array.from({ length: n }, () => q(d, 'approved'));
const bad = (d: number, n: number) => Array.from({ length: n }, () => q(d, 'rejected', 'La respuesta marcada es incorrecta: el calculo esta mal'));
const pb = (id: string, version: number, status: PlaybookVersionRow['status'], d: number | null): PlaybookVersionRow => ({ id, version, status, activated_at: d === null ? null : day(d) });

describe('outcomeOf', () => {
  it('aprobada = buena; rechazada por el profesor = mala aunque no tenga motivo', () => {
    expect(outcomeOf(q(1, 'approved'))).toBe('good');
    expect(outcomeOf(q(1, 'rejected', null, 'teacher'))).toBe('bad');
  });
  it('rechazo del juez: mala solo si el motivo es atribuible al generador; infraestructura, pipeline, validador de forma y pendientes se excluyen', () => {
    expect(outcomeOf(q(1, 'rejected', 'La respuesta marcada es incorrecta: el calculo esta mal'))).toBe('bad');
    expect(outcomeOf(q(1, 'human_review', 'No se pudo obtener una segunda opinion: un humano debe confirmar esta pregunta.'))).toBe('excluded');
    expect(outcomeOf(q(1, 'rejected', null))).toBe('excluded');
    expect(outcomeOf(q(1, 'rejected', '[validador de forma] falta el campo'))).toBe('excluded');
    expect(outcomeOf(q(1, 'pending'))).toBe('excluded');
  });
  it('tally cuenta solo buenas y malas en n', () => {
    const r = tally([...good(1, 3), ...bad(1, 2), q(1, 'pending')]);
    expect(r).toEqual({ good: 3, bad: 2, excluded: 1, n: 5 });
  });
});

describe('watchActivePlaybook', () => {
  it('sin cuaderno activo no hay nada que vigilar', () => {
    expect(watchActivePlaybook([pb('a', 1, 'draft', null)], good(1, 50))).toBeNull();
    expect(watchActivePlaybook([pb('a', 1, 'retired', 5)], good(1, 50))).toBeNull();
  });
  it('periodo antes = desde siempre; despues = desde la activacion', () => {
    const w = watchActivePlaybook([pb('a', 1, 'active', 10)], [...good(1, 40), ...good(12, 40)])!;
    expect(w.before.n).toBe(40);
    expect(w.after.n).toBe(40);
    expect(w.previousVersion).toBeNull();
  });
  it('con una version previa, el «antes» es solo su periodo (no lo anterior a ella)', () => {
    const rows = [...bad(1, 50), ...good(6, 40), ...good(12, 40)];
    const w = watchActivePlaybook([pb('a', 1, 'retired', 5), pb('b', 2, 'active', 10)], rows)!;
    expect(w.previousVersion).toBe(1);
    expect(w.previousId).toBe('a');
    expect(w.before.n).toBe(40);
  });
  it('muestra insuficiente => sin_datos (menos de 30 por periodo)', () => {
    const w = watchActivePlaybook([pb('a', 1, 'active', 10)], [...good(1, 10), ...bad(12, 10)])!;
    expect(w.level).toBe('sin_datos');
  });
  it('REGRESION: el intervalo entero del lado malo', () => {
    const w = watchActivePlaybook([pb('a', 1, 'active', 10)], [...good(1, 100), ...good(12, 20), ...bad(12, 80)])!;
    expect(w.level).toBe('regresion');
  });
  it('VIGILAR: cae 10 puntos o mas pero sin certeza', () => {
    const w = watchActivePlaybook([pb('a', 1, 'active', 10)], [...good(1, 36), ...bad(1, 4), ...good(12, 32), ...bad(12, 8)])!;
    expect(w.comparison.diff).toBeCloseTo(-0.1, 5);
    expect(w.level).toBe('vigilar');
  });
  it('ESTABLE si no cambia, y MEJORA solo con intervalo entero del lado bueno', () => {
    expect(watchActivePlaybook([pb('a', 1, 'active', 10)], [...good(1, 36), ...bad(1, 4), ...good(12, 36), ...bad(12, 4)])!.level).toBe('estable');
    expect(watchActivePlaybook([pb('a', 1, 'active', 10)], [...good(1, 20), ...bad(1, 80), ...good(12, 100)])!.level).toBe('mejora');
  });
});

describe('monitorReport', () => {
  const cal = (status: Calibration['status']) => ({ status, pairs: 46 }) as unknown as Calibration;
  it('regresion => alerta urgente que PROPONE volver a la version anterior (nunca la ejecuta)', () => {
    const rows = [...bad(1, 50), ...good(6, 100), ...good(12, 20), ...bad(12, 80)];
    const r = monitorReport({ playbooks: [pb('a', 1, 'retired', 5), pb('b', 2, 'active', 10)], questions: rows, calibration: null, humanReviewPending: 0 });
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ id: 'cuaderno_regresion', level: 'urgente', action: { kind: 'revertir_cuaderno', toVersion: 1, toId: 'a' } });
  });
  it('sin version previa la reversion es desactivar el cuaderno (toVersion null)', () => {
    const r = monitorReport({ playbooks: [pb('a', 1, 'active', 10)], questions: [...good(1, 100), ...good(12, 20), ...bad(12, 80)], calibration: null, humanReviewPending: 0 });
    expect(r.alerts[0].action).toMatchObject({ kind: 'revertir_cuaderno', toVersion: null });
    expect(r.alerts[0].detail).toContain('desactivar el cuaderno');
  });
  it('juez degradado y cola larga generan sus avisos; un juez confiable o una cola corta, no', () => {
    const base = { playbooks: [], questions: [] as QuestionRow[], humanReviewPending: LONG_QUEUE };
    expect(monitorReport({ ...base, calibration: cal('degraded') }).alerts.map((a) => a.id).sort()).toEqual(['cola_larga', 'juez_degradado']);
    expect(monitorReport({ ...base, calibration: cal('trusted'), humanReviewPending: LONG_QUEUE - 1 }).alerts).toEqual([]);
  });
  it('todo estable: sin alertas (y un estable NO afirma que el cuaderno sirva)', () => {
    const r = monitorReport({ playbooks: [pb('a', 1, 'active', 10)], questions: [...good(1, 36), ...bad(1, 4), ...good(12, 36), ...bad(12, 4)], calibration: null, humanReviewPending: 0 });
    expect(r.alerts).toEqual([]);
    expect(r.watch?.level).toBe('estable');
  });
});
