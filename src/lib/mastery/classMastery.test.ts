import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ATTENTION_LIMIT, buildClassMastery, type ClassAttempt } from './classMastery';
import { fetchClassAttempts, MAX_PAGES, PAGE_SIZE } from './loadClass';
import { ClassMasteryView } from '@/components/teacher/ClassMasteryView';

const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}T12:00:00Z`;
// Respuestas de un estudiante en un modulo: n preguntas distintas, las primeras `ok` bien.
const run = (student_id: string, module_id: string, n: number, ok: number, prefix = ''): ClassAttempt[] =>
  Array.from({ length: n }, (_, i) => ({ student_id, module_id, question_id: `${prefix}${module_id}-q${i}`, was_correct: i < ok, attempted_at: day(1 + (i % 5)) }));

const students = [
  { id: 's1', name: 'Ana' },
  { id: 's2', name: 'Beto' },
  { id: 's3', name: 'Carla' },
];
const modules = [
  { id: 'm1', title: 'Oferta y demanda', objectiveId: 'o1' },
  { id: 'm2', title: 'Elasticidad', objectiveId: 'o1' },
  { id: 'm3', title: 'Monopolio', objectiveId: null },
];
const objectives = [
  { id: 'o1', title: 'Equilibrio de mercado' },
  { id: 'o2', title: 'Objetivo sin modulos' },
];

describe('buildClassMastery', () => {
  const attempts = [
    ...run('s1', 'm1', 5, 5), // Ana domina m1
    ...run('s2', 'm1', 5, 2), // Beto: por repasar en m1
    ...run('s3', 'm1', 5, 1), // Carla: por repasar en m1
    ...run('s1', 'm2', 3, 3), // Ana: m2 en progreso (poca evidencia)
    ...run('s2', 'm2', 5, 5), // Beto domina m2
  ];
  const r = buildClassMastery({ modules, objectives, students, attempts });

  it('el denominador son los inscritos: quien no empezo cuenta como sin empezar', () => {
    const m1 = r.groups[0].modules[0];
    expect(m1.counts).toEqual({ total: 3, mastered: 1, needs_review: 2, in_progress: 0, not_started: 0 });
    const m2 = r.groups[0].modules[1];
    expect(m2.counts).toEqual({ total: 3, mastered: 1, needs_review: 0, in_progress: 1, not_started: 1 });
    const m3 = r.groups[1].modules[0];
    expect(m3.counts).toMatchObject({ total: 3, not_started: 3 });
  });

  it('dice quienes estan en cada estado', () => {
    const m1 = r.groups[0].modules[0];
    expect(m1.students.needs_review.map((s) => s.name).sort()).toEqual(['Beto', 'Carla']);
    expect(m1.students.mastered.map((s) => s.name)).toEqual(['Ana']);
  });

  it('agrupa por objetivo (en el orden dado), omite objetivos sin modulos y deja los sueltos al final', () => {
    expect(r.groups.map((g) => g.objective?.id ?? null)).toEqual(['o1', null]);
    expect(r.groups[1].studentCounts).toBeNull();
  });

  it('el estado del objetivo por estudiante: dominado solo si domina todos sus modulos', () => {
    // Ana: m1 dominado + m2 en progreso -> en progreso. Beto: por repasar + dominado -> por repasar. Carla: por repasar + sin empezar -> por repasar.
    expect(r.groups[0].studentCounts).toEqual({ total: 3, mastered: 0, needs_review: 2, in_progress: 1, not_started: 0 });
  });

  it('"donde intervenir": modulos con estudiantes por repasar, los de mas estudiantes primero', () => {
    expect(r.attention.map((m) => m.moduleId)).toEqual(['m1']);
    expect(r.hasData).toBe(true);
    expect(r.students).toBe(3);
  });

  it('desempata por proporcion y respeta el limite', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, title: `M${i}`, objectiveId: null }));
    const att = many.flatMap((m, i) => run('s1', m.id, 5, 0, `${i}-`));
    expect(buildClassMastery({ modules: many, objectives: [], students, attempts: att }).attention).toHaveLength(ATTENTION_LIMIT);
  });

  it('ignora intentos de estudiantes no inscritos y de modulos que no son de la clase', () => {
    const res = buildClassMastery({
      modules,
      objectives,
      students,
      attempts: [...run('intruso', 'm1', 5, 5), ...run('s1', 'otro-modulo', 5, 5)],
    });
    expect(res.hasData).toBe(false);
    expect(res.groups[0].modules[0].counts.not_started).toBe(3);
  });

  it('un modulo cuyo objetivo ya no existe cae en los sueltos', () => {
    const res = buildClassMastery({ modules: [{ id: 'm9', title: 'Huérfano', objectiveId: 'borrado' }], objectives, students, attempts: [] });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].objective).toBeNull();
  });

  it('cuenta la ultima vez de cada pregunta: quien fallo y luego acerto domina', () => {
    const before = run('s1', 'm3', 5, 0).map((a) => ({ ...a, attempted_at: day(1) }));
    const after = run('s1', 'm3', 5, 5).map((a) => ({ ...a, attempted_at: day(9) }));
    const res = buildClassMastery({ modules, objectives, students, attempts: [...after, ...before] });
    expect(res.groups[1].modules[0].students.mastered.map((s) => s.name)).toEqual(['Ana']);
  });
});

// Base simulada con paginacion por range().
function fakePagedDb(total: number, opts: { error?: boolean } = {}) {
  const calls: { from: number; to: number }[] = [];
  const all = Array.from({ length: total }, (_, i) => ({ student_id: 's1', module_id: 'm1', question_id: `q${i}`, was_correct: true, attempted_at: day(1) }));
  const b: any = {
    select: () => b,
    eq: () => b,
    order: () => b,
    range: (from: number, to: number) => {
      calls.push({ from, to });
      return Promise.resolve(opts.error ? { data: null, error: { message: 'boom' } } : { data: all.slice(from, to + 1), error: null });
    },
  };
  return { db: { from: () => b }, calls };
}

describe('fetchClassAttempts', () => {
  it('pagina de 1000 en 1000 hasta agotar los datos', async () => {
    const { db, calls } = fakePagedDb(2500);
    const out = await fetchClassAttempts(db, 'c1');
    expect(out.rows).toHaveLength(2500);
    expect(out.truncated).toBe(false);
    expect(calls).toEqual([{ from: 0, to: 999 }, { from: 1000, to: 1999 }, { from: 2000, to: 2999 }]);
  });

  it('con exactamente un multiplo de la pagina pide una mas y termina', async () => {
    const { db, calls } = fakePagedDb(PAGE_SIZE);
    const out = await fetchClassAttempts(db, 'c1');
    expect(out.rows).toHaveLength(PAGE_SIZE);
    expect(calls).toHaveLength(2);
    expect(out.truncated).toBe(false);
  });

  it('con el tope de paginas avisa que esta truncado en vez de aparentar que esta completo', async () => {
    const { db } = fakePagedDb(PAGE_SIZE * (MAX_PAGES + 3));
    const out = await fetchClassAttempts(db, 'c1');
    expect(out.rows).toHaveLength(PAGE_SIZE * MAX_PAGES);
    expect(out.truncated).toBe(true);
  });

  it('propaga los errores de la base', async () => {
    await expect(fetchClassAttempts(fakePagedDb(10, { error: true }).db, 'c1')).rejects.toThrow('boom');
  });
});

describe('ClassMasteryView', () => {
  const full = buildClassMastery({
    modules,
    objectives,
    students,
    attempts: [...run('s1', 'm1', 5, 5), ...run('s2', 'm1', 5, 2), ...run('s3', 'm1', 5, 1)],
  });

  it('muestra "Dónde intervenir" con los nombres, y el detalle por módulo y objetivo en texto', () => {
    const html = renderToStaticMarkup(h(ClassMasteryView, { mastery: full }));
    expect(html).toContain('Dónde intervenir');
    expect(html).toContain('Oferta y demanda');
    expect(html).toContain('2 estudiantes por repasar de 3');
    expect(html).toContain('Beto, Carla');
    expect(html).toContain('Equilibrio de mercado');
    expect(html).toContain('Módulos sin objetivo asignado');
    expect(html).toContain('role="img"');
    expect(html).toContain('1 dominado, 2 por repasar, 0 en progreso, 0 sin empezar');
    expect(html).toContain('Ver quiénes');
    expect(html).toContain('provisionales');
  });

  it('avisa cuando los datos pueden estar incompletos', () => {
    expect(renderToStaticMarkup(h(ClassMasteryView, { mastery: full, truncated: true }))).toContain('pueden estar incompletos');
    expect(renderToStaticMarkup(h(ClassMasteryView, { mastery: full }))).not.toContain('pueden estar incompletos');
  });

  it('estados vacíos claros: sin estudiantes, sin módulos, sin respuestas y con error', () => {
    const base = { objectives, modules };
    expect(renderToStaticMarkup(h(ClassMasteryView, { mastery: buildClassMastery({ ...base, students: [], attempts: [] }) }))).toContain('Aún no hay estudiantes');
    expect(renderToStaticMarkup(h(ClassMasteryView, { mastery: buildClassMastery({ modules: [], objectives, students, attempts: [] }) }))).toContain('aún no tiene módulos');
    expect(renderToStaticMarkup(h(ClassMasteryView, { mastery: buildClassMastery({ ...base, students, attempts: [] }) }))).toContain('Aún no hay respuestas');
    const err = renderToStaticMarkup(h(ClassMasteryView, { mastery: null, error: 'No se pudo calcular' }));
    expect(err).toContain('role="alert"');
    expect(err).toContain('No se pudo calcular');
  });

  it('si nadie necesita repaso lo dice', () => {
    const ok = buildClassMastery({ modules, objectives, students, attempts: [...run('s1', 'm1', 5, 5), ...run('s2', 'm1', 5, 5)] });
    expect(renderToStaticMarkup(h(ClassMasteryView, { mastery: ok }))).toContain('Ningún estudiante tiene módulos por repasar');
  });
});
