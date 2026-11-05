import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { checkLessonAccess } from './lessonAccess';
import type { CourseData } from './studentData';
import type { Blueprint } from './types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plan = (): Blueprint => ({
  version: 1,
  outcomes: [{ id: 'o1', statement: 'x' }],
  periods: [{ id: 'p1', name: 'Corte', order: 1, weight: 100, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'Obj', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Uno', order: 1 }, { id: 'm2', title: 'Dos', order: 2 }] }] }],
});
const ok = (mods: Record<string, number[]> = {}, scores = true): CourseData => ({
  status: 'ok', plan: plan(), version: 1, links: [{ nodeId: 'm1', moduleId: id(1) }, { nodeId: 'm2', moduleId: id(2) }], realTitles: new Map(),
  moduleAttempts: new Map(Object.entries(mods)), periodExamAttempts: new Map(), finalExamAttempts: [], scoresAvailable: scores,
});

// Cliente falso: class_enrollments.select().eq().eq().maybeSingle()
const client = (res: { data?: unknown; error?: unknown }) => {
  const calls: string[][] = [];
  const chain: any = { select: () => chain, eq: (c: string, v: string) => (calls.push([c, v]), chain), maybeSingle: async () => ({ data: res.data ?? null, error: res.error ?? null }) };
  return { db: { from: (t: string) => (calls.push(['from', t]), chain) }, calls };
};
const base = { admin: {}, userId: 'u1', classroomId: 'c1' };

describe('checkLessonAccess', () => {
  it('un estudiante matriculado: abre el que le toca y no el siguiente', async () => {
    const c = client({ data: { id: 'e' } });
    expect(await checkLessonAccess({ ...base, db: c.db, moduleId: id(1) }, async () => ok())).toEqual({ allowed: true });
    const g = await checkLessonAccess({ ...base, db: c.db, moduleId: id(2) }, async () => ok());
    expect(g.allowed).toBe(false);
    expect(!g.allowed && g.message).toContain('Todavía no puedes abrir esta lección');
  });
  it('con el modulo anterior al 100 %, abre el siguiente', async () => {
    const c = client({ data: { id: 'e' } });
    expect(await checkLessonAccess({ ...base, db: c.db, moduleId: id(2) }, async () => ok({ [id(1)]: [100] }))).toEqual({ allowed: true });
  });
  it('quien NO esta matriculado (profesor) abre todo, y ni siquiera se leen los intentos', async () => {
    const c = client({ data: null });
    const load = vi.fn(async () => ok());
    expect(await checkLessonAccess({ ...base, db: c.db, moduleId: id(2) }, load)).toEqual({ allowed: true });
    expect(load).not.toHaveBeenCalled();
  });
  it('consulta la matricula de ESE usuario en ESA clase', async () => {
    const c = client({ data: { id: 'e' } });
    await checkLessonAccess({ ...base, db: c.db, moduleId: id(1) }, async () => ok());
    expect(c.calls).toEqual([['from', 'class_enrollments'], ['classroom_id', 'c1'], ['student_id', 'u1']]);
  });
  it('plan ilegible: no se bloquea', async () => {
    const c = client({ data: { id: 'e' } });
    const legacy = vi.fn(async () => ({ allowed: false as const, message: 'x' }));
    expect(await checkLessonAccess({ ...base, db: c.db, moduleId: id(2) }, async () => ({ status: 'unreadable' }), legacy)).toEqual({ allowed: true });
    expect(legacy).not.toHaveBeenCalled();
  });
  it('sin plan publicado: manda la regla del mapa (prerrequisitos), no abre todo', async () => {
    const c = client({ data: { id: 'e' } });
    const deny = vi.fn(async () => ({ allowed: false as const, message: 'Primero domina «A» al 100 %.' }));
    const g = await checkLessonAccess({ ...base, db: c.db, moduleId: id(2) }, async () => ({ status: 'noPlan' }), deny);
    expect(g).toEqual({ allowed: false, message: 'Primero domina «A» al 100 %.' });
    expect(deny).toHaveBeenCalledWith({ db: c.db, admin: base.admin, userId: 'u1', moduleId: id(2) });
    expect(await checkLessonAccess({ ...base, db: c.db, moduleId: id(2) }, async () => ({ status: 'noPlan' }), async () => ({ allowed: true }))).toEqual({ allowed: true });
  });
  it('con plan, un modulo que el plan NO enlaza tambien cae en la regla del mapa', async () => {
    const c = client({ data: { id: 'e' } });
    const deny = vi.fn(async () => ({ allowed: false as const, message: 'no' }));
    expect((await checkLessonAccess({ ...base, db: c.db, moduleId: id(9) }, async () => ok(), deny)).allowed).toBe(false);
    expect(deny).toHaveBeenCalledOnce();
    const never = vi.fn(async () => ({ allowed: true as const }));
    await checkLessonAccess({ ...base, db: c.db, moduleId: id(1) }, async () => ok(), never);
    expect(never).not.toHaveBeenCalled(); // un modulo enlazado lo decide el plan
  });
  it('si no se pueden leer los intentos: no se bloquea y se registra', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = client({ data: { id: 'e' } });
    expect(await checkLessonAccess({ ...base, db: c.db, moduleId: id(2) }, async () => ok({}, false))).toEqual({ allowed: true });
    expect(err).toHaveBeenCalledWith(expect.stringContaining('LESSON_GATE_DEGRADED'), expect.anything());
    err.mockRestore();
  });
  it('una falla de la base o del cargador NO bloquea (y se registra)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await checkLessonAccess({ ...base, db: client({ error: { message: 'boom' } }).db, moduleId: id(2) }, async () => ok())).toEqual({ allowed: true });
    expect(await checkLessonAccess({ ...base, db: client({ data: { id: 'e' } }).db, moduleId: id(2) }, async () => { throw new Error('se cayo'); })).toEqual({ allowed: true });
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});

describe('generate-questions: el bloqueo corre ANTES de servir o generar', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/generate-questions/route.ts'), 'utf8');
  const idx = (s: string) => route.indexOf(s);
  it('comprueba el acceso antes del atajo de repaso, del cache y de la generacion', () => {
    expect(route).toContain('checkLessonAccess(');
    expect(idx('checkLessonAccess(')).toBeGreaterThan(-1);
    expect(idx('checkLessonAccess(')).toBeLessThan(idx('generateRemediationQuestions(supabase'));
    expect(idx('checkLessonAccess(')).toBeLessThan(idx('startLessonAttempt(supabase, moduleId, picked)'));
    expect(idx('checkLessonAccess(')).toBeLessThan(idx('withGenerationLock('));
  });
  it('un bloqueo responde 403 con el motivo y un codigo que la pantalla reconoce', () => {
    expect(route).toContain("code: 'locked'");
    expect(route).toMatch(/\{ status: 403 \}/);
  });
});
