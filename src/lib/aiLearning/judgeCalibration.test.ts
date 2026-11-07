import { describe, expect, it } from 'vitest';
import { calibrateJudge, pairJudgeTeacher, wilsonLower, type FeedbackEvent } from './judgeCalibration';

const ev = (q: string, signal: FeedbackEvent['signal'], verdict: FeedbackEvent['verdict'], t: number, reason: string | null = null): FeedbackEvent => ({
  question_id: q,
  signal,
  verdict,
  reason,
  created_at: new Date(2026, 10, 1, 0, 0, t).toISOString(),
});

describe('wilsonLower', () => {
  it('es null sin datos y crece con la muestra a igual proporcion', () => {
    expect(wilsonLower(0, 0)).toBeNull();
    expect(wilsonLower(8, 10)!).toBeLessThan(wilsonLower(80, 100)!);
    expect(wilsonLower(10, 10)!).toBeLessThan(1);
  });
});

describe('pairJudgeTeacher', () => {
  it('usa el ultimo veredicto del juez ANTERIOR a la decision del profesor', () => {
    const { pairs } = pairJudgeTeacher([ev('a', 'judge', 'approved', 1), ev('a', 'judge', 'rejected', 2), ev('a', 'teacher', 'rejected', 3)]);
    expect(pairs).toEqual([{ questionId: 'a', judge: 'fail', teacher: 'rejected' }]);
  });
  it('ignora veredictos del juez posteriores al profesor', () => {
    const { pairs } = pairJudgeTeacher([ev('a', 'judge', 'approved', 1), ev('a', 'teacher', 'rejected', 2), ev('a', 'judge', 'rejected', 3)]);
    expect(pairs[0].judge).toBe('pass');
  });
  it('recupera el veredicto del juez desde la razon del profesor (datos anteriores a la 096)', () => {
    const { pairs, unpaired } = pairJudgeTeacher([ev('a', 'teacher', 'rejected', 1, '[juez actual: pass] cumple'), ev('b', 'teacher', 'rejected', 1, 'sin etiqueta')]);
    expect(pairs).toEqual([{ questionId: 'a', judge: 'pass', teacher: 'rejected' }]);
    expect(unpaired).toBe(1);
  });
  it('sin decision del profesor no hay par', () => {
    expect(pairJudgeTeacher([ev('a', 'judge', 'approved', 1)]).pairs).toEqual([]);
  });
});

describe('calibrateJudge', () => {
  const many = (agree: number, falsePass: number, falseFail = 0) => {
    const e: FeedbackEvent[] = [];
    let i = 0;
    for (let k = 0; k < agree; k++) e.push(ev(`g${i}`, 'judge', 'rejected', 1), ev(`g${i++}`, 'teacher', 'rejected', 2));
    for (let k = 0; k < falsePass; k++) e.push(ev(`p${i}`, 'judge', 'approved', 1), ev(`p${i++}`, 'teacher', 'rejected', 2));
    for (let k = 0; k < falseFail; k++) e.push(ev(`f${i}`, 'judge', 'rejected', 1), ev(`f${i++}`, 'teacher', 'approved', 2));
    return e;
  };

  it('con pocos pares decisivos NO concluye (insufficient, peso null) aunque el acuerdo sea alto', () => {
    const c = calibrateJudge(many(12, 2));
    expect(c.status).toBe('insufficient');
    expect(c.weight).toBeNull();
    expect(c.decisive).toBe(14);
    expect(c.falsePass).toBe(2);
  });
  it('con volumen y buen acuerdo es trusted (peso 1)', () => {
    const c = calibrateJudge(many(95, 5));
    expect(c.status).toBe('trusted');
    expect(c.weight).toBe(1);
  });
  it('con volumen y acuerdo bajo es degraded (peso 0)', () => {
    const c = calibrateJudge(many(15, 10, 5));
    expect(c.status).toBe('degraded');
    expect(c.weight).toBe(0);
    expect(c.falseFail).toBe(5);
  });
  it('los veredictos review no cuentan a favor ni en contra', () => {
    const c = calibrateJudge([ev('a', 'judge', 'human_review', 1), ev('a', 'teacher', 'approved', 2)]);
    expect(c.review).toBe(1);
    expect(c.decisive).toBe(0);
    expect(c.agreementRate).toBeNull();
  });
});
