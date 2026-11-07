import { describe, expect, it } from 'vitest';
import { buildRetrospective, buildSnapshot, type CycleInput } from './retrospective';

const base = (over: Partial<CycleInput> = {}): CycleInput => ({
  windowStart: '2026-01-01T00:00:00Z',
  windowEnd: '2026-06-30T00:00:00Z',
  modules: [{ id: 'm1', title: 'Oferta' }, { id: 'm2', title: 'Demanda' }],
  finishedLessons: [],
  questionAttempts: [],
  questions: [],
  feedbackEvents: [],
  ...over,
});

const lessons = (module_id: string, n: number, score: number) => Array.from({ length: n }, (_, i) => ({ module_id, student_id: `s${i}`, score_percent: score }));
const attempts = (question_id: string, tag: string | null, n: number, okCount: number) => Array.from({ length: n }, (_, i) => ({ question_id, concept_tag: tag, was_correct: i < okCount, student_id: `s${i}` }));

describe('buildSnapshot', () => {
  it('no guarda identificadores de estudiantes ni texto: solo conteos y tasas', () => {
    const s = buildSnapshot(base({ finishedLessons: lessons('m1', 6, 50), questionAttempts: attempts('q1', 'oferta', 12, 3) }));
    expect(s.students).toBe(12);
    expect(JSON.stringify(s)).not.toMatch(/"s\d"/);
    expect(s.modules[0]).toMatchObject({ finished: 6, students: 6, avgScore: 50 });
    expect(s.concepts[0]).toMatchObject({ tag: 'oferta', attempts: 12, rate: 0.25 });
  });
  it('solo lista preguntas dificiles/faciles con muestra minima', () => {
    const s = buildSnapshot(base({ questionAttempts: [...attempts('dura', 'a', 12, 0), ...attempts('poca', 'a', 3, 0), ...attempts('facil', 'b', 20, 20)] }));
    expect(s.hardQuestions.map((q) => q.id)).toEqual(['dura']);
    expect(s.easyQuestions.map((q) => q.id)).toEqual(['facil']);
  });
  it('cuenta el estado del banco', () => {
    const s = buildSnapshot(base({ questions: [{ id: 'a', module_id: 'm1', review_status: 'approved' }, { id: 'b', module_id: 'm1', review_status: 'pending' }, { id: 'c', module_id: 'm1', review_status: 'human_review' }] }));
    expect(s.questionBank).toEqual({ total: 3, approved: 1, rejected: 0, humanReview: 1, pending: 1 });
  });
});

describe('buildRetrospective', () => {
  it('sin actividad dice que no hay datos y no inventa hallazgos de rendimiento', () => {
    const r = buildRetrospective(buildSnapshot(base()));
    expect(r.findings.some((f) => f.id === 'no-activity' && !f.conclusive)).toBe(true);
    expect(r.findings.some((f) => f.kind === 'module' || f.kind === 'concept')).toBe(false);
  });
  it('con muestra pequeña NO concluye (modulo con 3 lecciones malas no es hallazgo)', () => {
    const r = buildRetrospective(buildSnapshot(base({ finishedLessons: lessons('m1', 3, 10), questionAttempts: attempts('q1', 'c', 4, 0) })));
    expect(r.findings.find((f) => f.kind === 'module')).toBeUndefined();
    expect(r.findings.find((f) => f.kind === 'concept')).toBeUndefined();
    expect(r.findings.find((f) => f.id === 'insufficient-or-fine')?.evidence).toContain('menos de 5');
  });
  it('con muestra suficiente señala modulo y concepto debiles, cada uno con evidencia y sugerencia pendiente', () => {
    const r = buildRetrospective(buildSnapshot(base({ finishedLessons: [...lessons('m1', 8, 40), ...lessons('m2', 8, 90)], questionAttempts: attempts('q1', 'elasticidad', 20, 3) })));
    const mod = r.findings.find((f) => f.kind === 'module')!;
    expect(mod.text).toContain('Oferta');
    expect(mod.evidence).toContain('40 %');
    expect(r.findings.some((f) => f.kind === 'module' && f.text.includes('Demanda'))).toBe(false);
    expect(r.findings.find((f) => f.kind === 'concept')!.evidence).toContain('20 intentos');
    expect(r.suggestions.every((s) => s.status === 'pending' && s.evidence.length > 0)).toBe(true);
    expect(r.suggestions.map((s) => s.kind)).toEqual(expect.arrayContaining(['reinforce_module', 'reinforce_concept', 'review_question']));
  });
  it('avisa de la cola sin resolver y de que el juez no se puede medir aun', () => {
    const r = buildRetrospective(buildSnapshot(base({ questions: [{ id: 'a', module_id: 'm1', review_status: 'pending' }] })));
    expect(r.findings.find((f) => f.id === 'pending-review')?.evidence).toContain('1 sin juzgar');
    expect(r.findings.find((f) => f.id === 'judge-data')?.conclusive).toBe(false);
  });
  it('los ids de sugerencia son unicos', () => {
    const r = buildRetrospective(buildSnapshot(base({ finishedLessons: lessons('m1', 8, 10), questionAttempts: [...attempts('a', 'x', 12, 0), ...attempts('b', 'y', 12, 0)] })));
    expect(new Set(r.suggestions.map((s) => s.id)).size).toBe(r.suggestions.length);
  });
});
