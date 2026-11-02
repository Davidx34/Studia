import { describe, expect, it } from 'vitest';
import { buildCourseView } from './studentView';
import type { Blueprint } from './types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'x' }],
  periods: [
    { id: 'p1', name: 'Primer corte', order: 1, weight: 40, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'Obj 1', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Uno', order: 1 }, { id: 'm2', title: 'Dos', order: 2 }] }] },
    { id: 'p2', name: 'Segundo corte', order: 2, weight: 60, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob2', title: 'Obj 2', outcomeIds: ['o1'], modules: [{ id: 'm3', title: 'Tres', order: 1 }] }] },
  ],
});
const ALL = [{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm2', moduleId: id(2) }, { nodeId: 'm3', moduleId: id(3) }];
const att = (o: Record<string, number[]>) => new Map(Object.entries(o));
const states = (v: ReturnType<typeof buildCourseView>) => v.periods.flatMap((p) => p.modules.map((m) => [m.nodeId, m.state]));

describe('buildCourseView: estados de los modulos', () => {
  it('estudiante nuevo con todo enlazado: el primero esta disponible y los demas bloqueados', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({}) });
    expect(states(v)).toEqual([['m1', 'available'], ['m2', 'locked'], ['m3', 'locked']]);
    expect(v.totals).toEqual({ modules: 3, mastered: 0, pendingContent: 0 });
  });
  it('las evaluaciones de los cortes parten bloqueadas (se desbloquean al dominar sus modulos)', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({}) });
    expect(v.periods.map((p) => p.exam.state)).toEqual(['locked', 'locked']);
    const mid = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({ [id(1)]: [100] }) }); // falta m2
    expect(mid.periods[0].exam.state).toBe('locked');
  });
  it('cuenta los modulos dominados y los pendientes de contenido', () => {
    const v = buildCourseView({ plan: plan(), links: [ALL[0], ALL[1]], moduleAttempts: att({ [id(1)]: [100], [id(2)]: [100] }) });
    expect(v.totals).toEqual({ modules: 3, mastered: 2, pendingContent: 1 });
  });
  it('un 100 % domina el modulo y abre el siguiente; 90 % no domina', () => {
    expect(states(buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({ [id(1)]: [100] }) }))).toEqual([['m1', 'mastered'], ['m2', 'available'], ['m3', 'locked']]);
    expect(states(buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({ [id(1)]: [90] }) }))).toEqual([['m1', 'available'], ['m2', 'locked'], ['m3', 'locked']]);
  });
  it('un dominado sigue dominado aunque otros intentos hayan sido peores (basta un 100)', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({ [id(1)]: [60, 100] }) });
    expect(v.periods[0].modules[0]).toMatchObject({ state: 'mastered', score: 80, attempts: 2 });
  });
  it('la nota del modulo es el PROMEDIO de todos sus intentos', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({ [id(1)]: [80, 90, 100] }) });
    expect(v.periods[0].modules[0].score).toBe(90);
  });
  it('sin intentos no hay nota (no es un cero)', () => {
    expect(buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({}) }).periods[0].modules[0]).toMatchObject({ score: null, attempts: 0 });
  });
  it('un modulo SIN enlace esta pendiente de contenido y bloquea lo que sigue', () => {
    const v = buildCourseView({ plan: plan(), links: [{ nodeId: 'm2', moduleId: id(2) }, { nodeId: 'm3', moduleId: id(3) }], moduleAttempts: att({}) });
    expect(states(v)[0]).toEqual(['m1', 'pendingContent']);
    expect(v.periods[0].modules[0].moduleId).toBeNull();
    expect(states(v).slice(1)).toEqual([['m2', 'locked'], ['m3', 'locked']]);
    expect(v.totals.pendingContent).toBe(1);
  });
  it('un modulo pendiente de contenido NUNCA se muestra como dominado, aunque haya intentos de otro modulo con su id', () => {
    const v = buildCourseView({ plan: plan(), links: [{ nodeId: 'm2', moduleId: id(2) }], moduleAttempts: att({ m1: [100], [id(1)]: [100] }) });
    expect(v.periods[0].modules[0]).toMatchObject({ state: 'pendingContent', score: null, attempts: 0 });
  });
  it('los intentos se toman del modulo REAL enlazado, no del id del plan', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({ m1: [100] }) }); // clave equivocada: el id del plan
    expect(v.periods[0].modules[0].state).toBe('available');
  });
  it('puntajes fuera de 0-100 se ignoran (un dato corrupto no sube la nota)', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({ [id(1)]: [500, -3, Number.NaN] }) });
    expect(v.periods[0].modules[0]).toMatchObject({ state: 'available', score: null });
  });
  it('el orden es el del recorrido (corte, objetivo, modulo) aunque el plan este desordenado', () => {
    const p = plan();
    p.periods.reverse();
    p.periods[1].objectives[0].modules.reverse();
    expect(states(buildCourseView({ plan: p, links: ALL, moduleAttempts: att({}) })).map((s) => s[0])).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('buildCourseView: evaluaciones, notas y lo siguiente', () => {
  const done1 = att({ [id(1)]: [100], [id(2)]: [100] });
  it('dominados los modulos de un corte, su evaluacion queda disponible y el siguiente corte espera', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: done1 });
    expect(v.periods[0].exam.state).toBe('available');
    expect(v.periods[1].modules[0].state).toBe('locked');
    expect(v.next.kind).toBe('periodExam');
    expect(v.next.text).toContain('sigue su evaluación');
    expect(v.next.text).not.toContain('no está disponible');
  });
  it('con la evaluacion del corte al 100 % se abre el siguiente corte', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: done1, periodExamAttempts: att({ p1: [100] }) });
    expect(v.periods[0].exam.state).toBe('mastered');
    expect(v.periods[1].modules[0].state).toBe('available');
  });
  it('la evaluacion final solo se desbloquea al terminar todos los cortes', () => {
    expect(buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({}) }).finalExam.state).toBe('locked');
    const all = att({ [id(1)]: [100], [id(2)]: [100], [id(3)]: [100] });
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: all, periodExamAttempts: att({ p1: [100], p2: [100] }) });
    expect(v.finalExam.state).toBe('available');
    expect(v.next.kind).toBe('finalExam');
    const fin = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: all, periodExamAttempts: att({ p1: [100], p2: [100] }), finalExamAttempts: [100] });
    expect(fin.finalExam.state).toBe('mastered');
    expect(fin.next).toEqual({ kind: 'done', text: '¡Completaste el curso!' });
  });
  it('la nota se va computando: 70 % modulos del corte, y lo no calificado no cuenta como cero', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({ [id(1)]: [100] }) });
    // corte 1: un modulo de dos al 100 -> 35 puntos sobre 35 calificados (nota 100)
    expect(v.periods[0].result).toMatchObject({ points: 35, gradedShare: 35, score: 100, modulesDone: 1, modulesMastered: 1 });
    expect(v.grade.average).toBe(100);
    expect(v.grade.graded).toBe(false);
  });
  it('la nota del curso pesa los cortes y la evaluacion final cuenta medio corte', () => {
    const all = att({ [id(1)]: [100], [id(2)]: [100], [id(3)]: [100] });
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: all, periodExamAttempts: att({ p1: [100], p2: [100] }), finalExamAttempts: [100] });
    expect(v.grade).toMatchObject({ earned: 100, average: 100, graded: true });
    expect(v.finalExam.weight).toBe(25); // la mitad del peso promedio (50) de un corte
  });
  it('sin ningun intento la nota esta vacia (no es un cero)', () => {
    const v = buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({}) });
    expect(v.grade).toMatchObject({ earned: 0, completedWeight: 0, average: null, graded: false });
  });
  it('lo siguiente: el modulo que toca, con el aviso del 100 %, o que no tiene contenido', () => {
    expect(buildCourseView({ plan: plan(), links: ALL, moduleAttempts: att({}) }).next).toMatchObject({ kind: 'module', nodeId: 'm1', text: expect.stringContaining('100 %') });
    const v = buildCourseView({ plan: plan(), links: [], moduleAttempts: att({}) });
    expect(v.next.text).toContain('todavía no ha preparado su contenido');
  });
  it('un plan sin modulos se dice claramente', () => {
    const p = plan();
    p.periods.forEach((x) => x.objectives.forEach((o) => (o.modules = [])));
    expect(buildCourseView({ plan: p, links: [], moduleAttempts: att({}) }).next.kind).toBe('empty');
  });
  it('no cambia sus entradas', () => {
    const p = plan();
    const before = JSON.stringify([p, ALL]);
    buildCourseView({ plan: p, links: ALL, moduleAttempts: att({ [id(1)]: [100] }) });
    expect(JSON.stringify([p, ALL])).toBe(before);
  });
});
