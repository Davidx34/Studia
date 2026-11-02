import { describe, expect, it } from 'vitest';
import { examGate, lessonGate } from './courseGate';
import type { CourseData } from './studentData';
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

type Ok = Extract<CourseData, { status: 'ok' }>;
const data = (o: { mods?: Record<string, number[]>; exams?: Record<string, number[]>; final?: number[]; links?: typeof ALL; scores?: boolean } = {}): Ok => ({
  status: 'ok',
  plan: plan(),
  version: 1,
  links: o.links ?? ALL,
  realTitles: new Map(),
  moduleAttempts: new Map(Object.entries(o.mods ?? {})),
  periodExamAttempts: new Map(Object.entries(o.exams ?? {})),
  finalExamAttempts: o.final ?? [],
  scoresAvailable: o.scores ?? true,
});
const blocked = (g: ReturnType<typeof lessonGate>) => (g.allowed ? null : g.message);

describe('lessonGate: 100 % para avanzar', () => {
  it('estudiante nuevo: abre el primero; el segundo y el tercero, no', () => {
    expect(lessonGate(data(), id(1))).toEqual({ allowed: true });
    expect(lessonGate(data(), id(2)).allowed).toBe(false);
    expect(lessonGate(data(), id(3)).allowed).toBe(false);
  });
  it('el mensaje dice que sigue (con el modulo que le toca y el 100 %)', () => {
    const m = blocked(lessonGate(data(), id(2)))!;
    expect(m).toContain('Todavía no puedes abrir esta lección');
    expect(m).toContain('«Uno»');
    expect(m).toContain('100 %');
  });
  it('un 100 % abre el siguiente; un 99 % no', () => {
    expect(lessonGate(data({ mods: { [id(1)]: [100] } }), id(2)).allowed).toBe(true);
    expect(lessonGate(data({ mods: { [id(1)]: [99.9] } }), id(2)).allowed).toBe(false);
  });
  it('un modulo ya dominado se puede repasar, y basta un 100 entre varios intentos', () => {
    expect(lessonGate(data({ mods: { [id(1)]: [50, 100], [id(2)]: [100] } }), id(1)).allowed).toBe(true);
    expect(lessonGate(data({ mods: { [id(1)]: [50, 100] } }), id(1)).allowed).toBe(true);
  });
  it('entre cortes: el primer modulo del segundo corte espera a la evaluacion del primero', () => {
    const modsDone = { [id(1)]: [100], [id(2)]: [100] };
    const g = lessonGate(data({ mods: modsDone }), id(3));
    expect(g.allowed).toBe(false);
    expect(blocked(g)).toContain('evaluación');
    expect(lessonGate(data({ mods: modsDone, exams: { p1: [100] } }), id(3)).allowed).toBe(true);
    expect(lessonGate(data({ mods: modsDone, exams: { p1: [80] } }), id(3)).allowed).toBe(false);
  });
  it('un modulo que NO esta en el plan (o sin enlace) no se toca', () => {
    expect(lessonGate(data(), id(99))).toEqual({ allowed: true });
    expect(lessonGate(data({ links: [ALL[0]] }), id(3))).toEqual({ allowed: true });
  });
  it('sin poder leer los intentos NO se bloquea (falla de infraestructura, no castigo)', () => {
    expect(lessonGate(data({ scores: false }), id(3))).toEqual({ allowed: true });
  });
  it('un modulo del plan SIN enlazar delante frena todo lo que sigue (por eso un plan asi no se publica)', () => {
    expect(lessonGate(data({ links: [ALL[1], ALL[2]] }), id(2)).allowed).toBe(false);
    expect(lessonGate(data({ links: [ALL[1], ALL[2]], mods: { [id(2)]: [100] } }), id(3)).allowed).toBe(false);
  });
});

describe('examGate', () => {
  const modsDone = { [id(1)]: [100], [id(2)]: [100] };
  it('la evaluacion de un corte espera a dominar todos sus modulos', () => {
    expect(examGate(data(), { kind: 'period', periodId: 'p1' }).allowed).toBe(false);
    expect(examGate(data({ mods: { [id(1)]: [100] } }), { kind: 'period', periodId: 'p1' }).allowed).toBe(false);
    expect(examGate(data({ mods: modsDone }), { kind: 'period', periodId: 'p1' })).toEqual({ allowed: true });
  });
  it('el mensaje nombra el corte y dice que sigue', () => {
    const g = examGate(data(), { kind: 'period', periodId: 'p1' });
    expect(g.allowed).toBe(false);
    if (!g.allowed) {
      expect(g.message).toContain('«Primer corte»');
      expect(g.message).toContain('100 %');
    }
  });
  it('la del segundo corte sigue bloqueada hasta que el primero este dominado entero', () => {
    expect(examGate(data({ mods: { ...modsDone, [id(3)]: [100] } }), { kind: 'period', periodId: 'p2' }).allowed).toBe(false);
    expect(examGate(data({ mods: { ...modsDone, [id(3)]: [100] }, exams: { p1: [100] } }), { kind: 'period', periodId: 'p2' }).allowed).toBe(true);
  });
  it('una evaluacion ya dominada no se bloquea aqui (lo dice el flujo del examen)', () => {
    expect(examGate(data({ mods: modsDone, exams: { p1: [100] } }), { kind: 'period', periodId: 'p1' }).allowed).toBe(true);
  });
  it('la final espera a todos los cortes', () => {
    expect(examGate(data(), { kind: 'final' }).allowed).toBe(false);
    expect(examGate(data({ mods: { ...modsDone, [id(3)]: [100] }, exams: { p1: [100] } }), { kind: 'final' }).allowed).toBe(false);
    expect(examGate(data({ mods: { ...modsDone, [id(3)]: [100] }, exams: { p1: [100], p2: [100] } }), { kind: 'final' })).toEqual({ allowed: true });
  });
  it('un corte que no existe, o sin poder leer intentos, no se bloquea aqui', () => {
    expect(examGate(data(), { kind: 'period', periodId: 'nope' })).toEqual({ allowed: true });
    expect(examGate(data({ scores: false }), { kind: 'final' })).toEqual({ allowed: true });
  });
});
