import { describe, expect, it } from 'vitest';
import { loadCourseData } from './studentData';
import type { Blueprint } from './types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plan = (): Blueprint => ({
  version: 2,
  outcomes: [{ id: 'o1', statement: 'x' }],
  periods: [{ id: 'p1', name: 'A', order: 1, weight: 100, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'T', outcomeIds: ['o1'], modules: [{ id: 'm1', title: 'Uno', order: 1 }, { id: 'm2', title: 'Dos', order: 2 }] }] }],
});

type Result = { data?: unknown; error?: { message: string } | null };
// Cliente simulado: cada tabla responde lo que se le diga; se registra la cadena de cada consulta para comprobar los FILTROS.
function fake(tables: Record<string, Result>) {
  const log: { table: string; chain: [string, unknown[]][] }[] = [];
  const client = {
    from(table: string) {
      const entry = { table, chain: [] as [string, unknown[]][] };
      log.push(entry);
      const q: any = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') return (res: (v: unknown) => unknown) => res({ data: tables[table]?.data ?? null, error: tables[table]?.error ?? null });
            return (...args: unknown[]) => {
              entry.chain.push([prop, args]);
              return q;
            };
          },
        }
      );
      return q;
    },
  };
  const q = (table: string) => log.filter((l) => l.table === table);
  const has = (table: string, op: string, ...args: unknown[]) => q(table).some((l) => l.chain.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args)));
  return { client, log, q, has };
}

const base = () => ({
  course_blueprints: { data: [{ id: 'bp1', version: 2, doc: plan() }] },
  blueprint_module_links: { data: [{ node_id: 'm1', content_module_id: id(1) }, { node_id: 'm2', content_module_id: id(2) }] },
  content_modules: { data: [{ id: id(1), title: 'Real uno', is_active: true }, { id: id(2), title: 'Real dos', is_active: true }] },
  exam_attempts: { data: [] },
});
const attempts = (rows: { module_id: string; score_percent: number | null }[]) => ({ lesson_attempts: { data: rows } });
const args = (db: any, admin: any, over = {}) => ({ db, admin, classroomId: 'c1', studentId: 's1', ...over });

describe('loadCourseData', () => {
  it('sin plan publicado: noPlan (y no lee nada mas)', async () => {
    const db = fake({ course_blueprints: { data: [] } });
    const admin = fake({});
    expect(await loadCourseData(args(db.client, admin.client))).toEqual({ status: 'noPlan' });
    expect(db.log).toHaveLength(1);
    expect(admin.log).toHaveLength(0);
  });
  it('error al leer el plan (p. ej. la tabla no existe): noPlan, no revienta', async () => {
    const db = fake({ course_blueprints: { error: { message: 'no existe' } } });
    expect(await loadCourseData(args(db.client, null))).toEqual({ status: 'noPlan' });
  });
  it('plan guardado ilegible: unreadable', async () => {
    const db = fake({ ...base(), course_blueprints: { data: [{ id: 'bp1', version: 2, doc: { periods: 5 } }] } });
    expect(await loadCourseData(args(db.client, null))).toEqual({ status: 'unreadable' });
  });
  it('pide SOLO el plan publicado de ESA clase, los enlaces de ESE plan y los modulos de ESA clase', async () => {
    const db = fake(base());
    await loadCourseData(args(db.client, fake(attempts([])).client));
    expect(db.has('course_blueprints', 'eq', 'classroom_id', 'c1')).toBe(true);
    expect(db.has('course_blueprints', 'eq', 'status', 'published')).toBe(true);
    expect(db.has('blueprint_module_links', 'eq', 'blueprint_id', 'bp1')).toBe(true);
    expect(db.has('content_modules', 'eq', 'classroom_id', 'c1')).toBe(true);
    expect(db.has('exam_attempts', 'eq', 'student_id', 's1')).toBe(true);
    expect(db.has('exam_attempts', 'eq', 'blueprint_id', 'bp1')).toBe(true);
  });
  it('los intentos se piden con la llave de servicio pero SOLO los terminados, DEL estudiante y de los modulos enlazados', async () => {
    const db = fake(base());
    const admin = fake(attempts([]));
    await loadCourseData(args(db.client, admin.client));
    expect(admin.has('lesson_attempts', 'eq', 'student_id', 's1')).toBe(true);
    expect(admin.has('lesson_attempts', 'eq', 'status', 'finished')).toBe(true);
    expect(admin.has('lesson_attempts', 'in', 'module_id', [id(1), id(2)])).toBe(true);
  });
  it('arma los intentos por modulo real, en orden, y solo con puntajes validos', async () => {
    const db = fake(base());
    const admin = fake(attempts([
      { module_id: id(1), score_percent: 80 },
      { module_id: id(1), score_percent: 100 },
      { module_id: id(2), score_percent: 50 },
      { module_id: id(2), score_percent: null },
      { module_id: id(2), score_percent: 999 },
      { module_id: id(2), score_percent: -1 },
    ]));
    const r = await loadCourseData(args(db.client, admin.client));
    if (r.status !== 'ok') throw new Error('fallo');
    expect(Object.fromEntries(r.moduleAttempts)).toEqual({ [id(1)]: [80, 100], [id(2)]: [50] });
    expect(r.scoresAvailable).toBe(true);
    expect(r.version).toBe(2);
  });
  it('un enlace a un modulo que el estudiante NO ve (o inactivo) no cuenta y no se piden sus intentos', async () => {
    const db = fake({ ...base(), content_modules: { data: [{ id: id(1), title: 'Real uno', is_active: true }, { id: id(2), title: 'Oculto', is_active: false }] } });
    const admin = fake(attempts([]));
    const r = await loadCourseData(args(db.client, admin.client));
    if (r.status !== 'ok') throw new Error('fallo');
    expect(r.links).toEqual([{ nodeId: 'm1', moduleId: id(1) }]);
    expect([...r.realTitles.keys()]).toEqual([id(1)]);
    expect(admin.has('lesson_attempts', 'in', 'module_id', [id(1)])).toBe(true);
  });
  it('un enlace con un id que no es uuid se ignora (no llega a ninguna consulta)', async () => {
    const db = fake({ ...base(), blueprint_module_links: { data: [{ node_id: 'm1', content_module_id: "x'; drop table--" }, { node_id: 'm2', content_module_id: id(2) }] } });
    const r = await loadCourseData(args(db.client, fake(attempts([])).client));
    if (r.status !== 'ok') throw new Error('fallo');
    expect(r.links).toEqual([{ nodeId: 'm2', moduleId: id(2) }]);
    expect(JSON.stringify(db.log)).not.toContain('drop table');
  });
  it('sin llave de servicio: se muestran los modulos pero sin notas, y se avisa', async () => {
    const r = await loadCourseData(args(fake(base()).client, null));
    if (r.status !== 'ok') throw new Error('fallo');
    expect(r.scoresAvailable).toBe(false);
    expect(r.moduleAttempts.size).toBe(0);
    expect(r.links).toHaveLength(2);
  });
  it('si leer los intentos falla: sin notas y se avisa (no revienta)', async () => {
    const admin = fake({ lesson_attempts: { error: { message: 'boom' } } });
    const r = await loadCourseData(args(fake(base()).client, admin.client));
    if (r.status !== 'ok') throw new Error('fallo');
    expect(r.scoresAvailable).toBe(false);
  });
  it('sin enlaces no hay nada que leer con la llave de servicio', async () => {
    const db = fake({ ...base(), blueprint_module_links: { data: [] } });
    const admin = fake(attempts([]));
    const r = await loadCourseData(args(db.client, admin.client));
    if (r.status !== 'ok') throw new Error('fallo');
    expect(admin.log).toHaveLength(0);
    expect(r.scoresAvailable).toBe(true);
    expect(r.links).toEqual([]);
  });
  it('las evaluaciones del estudiante se agrupan por corte y la final aparte (numeric llega como texto)', async () => {
    const db = fake({
      ...base(),
      exam_attempts: { data: [{ kind: 'period', period_id: 'p1', score_percent: '60.00' }, { kind: 'period', period_id: 'p1', score_percent: 100 }, { kind: 'final', period_id: null, score_percent: 75 }, { kind: 'period', period_id: 'p1', score_percent: 500 }] },
    });
    const r = await loadCourseData(args(db.client, fake(attempts([])).client));
    if (r.status !== 'ok') throw new Error('fallo');
    expect(Object.fromEntries(r.periodExamAttempts)).toEqual({ p1: [60, 100] });
    expect(r.finalExamAttempts).toEqual([75]);
  });
});
