import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { conceptLabel, pickAnchorModule, planReinforcement, weakConcepts, type ConceptAttempt } from './reinforcement';
import { buildClassMastery } from './classMastery';
import { ClassMasteryView } from '@/components/teacher/ClassMasteryView';

const day = (d: number, hour = 12) => `2026-10-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
const at = (question_id: string, was_correct: boolean, concept_tag: string | null, d = 1, hour = 12): ConceptAttempt => ({ question_id, was_correct, concept_tag, attempted_at: day(d, hour) });

describe('conceptLabel', () => {
  it('quita guiones bajos y pone la primera letra en mayuscula (igual que los planes de Por Estudiante)', () => {
    expect(conceptLabel('derecho_romano')).toBe('Derecho romano');
    expect(conceptLabel(' tms ')).toBe('Tms');
  });
});

describe('weakConcepts', () => {
  it('toma los conceptos de las preguntas cuya ULTIMA respuesta fue incorrecta', () => {
    const a = [at('q1', false, 'a'), at('q2', true, 'b'), at('q3', false, 'c')];
    expect(weakConcepts(a).sort()).toEqual(['a', 'c']);
  });

  it('una pregunta fallada y luego acertada ya no cuenta; acertada y luego fallada si', () => {
    const a = [at('q1', false, 'a', 1), at('q1', true, 'a', 5), at('q2', true, 'b', 1), at('q2', false, 'b', 6)];
    expect(weakConcepts(a)).toEqual(['b']);
    expect(weakConcepts([...a].reverse())).toEqual(['b']); // no depende del orden de llegada
  });

  it('primero el concepto con mas preguntas falladas; en empate, el que fallo mas recientemente', () => {
    const a = [at('q1', false, 'poco', 9), at('q2', false, 'mucho', 1), at('q3', false, 'mucho', 2), at('q4', false, 'viejo', 3), at('q5', false, 'reciente', 8)];
    expect(weakConcepts(a)).toEqual(['mucho', 'poco', 'reciente']);
  });

  it('acota a 3 por defecto, ignora preguntas sin concepto y recorta espacios', () => {
    const a = ['a', 'b', 'c', 'd', 'e'].map((t, i) => at(`q${i}`, false, t, i + 1));
    expect(weakConcepts(a)).toHaveLength(3);
    expect(weakConcepts([at('q1', false, null), at('q2', false, '  '), at('q3', false, ' x ')])).toEqual(['x']);
    expect(weakConcepts(a, 5)).toHaveLength(5);
    expect(weakConcepts([])).toEqual([]);
  });
});

describe('planReinforcement', () => {
  const students = [
    { id: 's1', name: 'Ana' },
    { id: 's2', name: 'Beto' },
    { id: 's3', name: 'Carla' },
    { id: 's4', name: 'Diego' },
  ];
  // 5 preguntas distintas: n bien, el resto mal, con concepto c0..c4.
  const lesson = (ok: number, tagged = true): ConceptAttempt[] => Array.from({ length: 5 }, (_, i) => at(`q${i}`, i < ok, tagged ? `c${i}` : null));

  it('asigna solo a quien esta POR REPASAR en el modulo (no a dominados, en progreso ni sin empezar)', () => {
    const r = planReinforcement({
      students,
      attemptsByStudent: new Map([
        ['s1', lesson(5)], // dominado
        ['s2', lesson(2)], // por repasar
        ['s3', [at('q0', false, 'c0')]], // en progreso (poca evidencia)
        // s4 sin empezar
      ]),
      activePlanStudentIds: new Set(),
    });
    expect(r.assignments.map((a) => a.name)).toEqual(['Beto']);
    expect(r.assignments[0].concepts.length).toBeGreaterThan(0);
    expect(r.skipped).toEqual([]);
  });

  it('omite (y dice por que) a quien ya tiene un plan activo o no tiene conceptos identificables', () => {
    const r = planReinforcement({
      students,
      attemptsByStudent: new Map([
        ['s1', lesson(1)],
        ['s2', lesson(1)],
        ['s3', lesson(1, false)], // sin conceptos
      ]),
      activePlanStudentIds: new Set(['s1']),
    });
    expect(r.assignments.map((a) => a.name)).toEqual(['Beto']);
    expect(r.skipped).toEqual([
      { studentId: 's1', name: 'Ana', reason: 'active_plan' },
      { studentId: 's3', name: 'Carla', reason: 'no_concepts' },
    ]);
  });

  it('usa los conceptos de las preguntas falladas', () => {
    const r = planReinforcement({ students, attemptsByStudent: new Map([['s1', lesson(3)]]), activePlanStudentIds: new Set() });
    expect([...r.assignments[0].concepts].sort()).toEqual(['c3', 'c4']);
  });
});

describe('pickAnchorModule', () => {
  const rows = [
    { module_id: 'm1', tag: 'a' },
    { module_id: 'm2', tag: 'a' },
    { module_id: 'm2', tag: 'b' },
    { module_id: 'm3', tag: 'zzz' },
  ];
  it('elige el modulo que registra mas conceptos del plan', () => {
    expect(pickAnchorModule(['a', 'b'], rows)).toBe('m2');
  });
  it('en empate gana el primero que aparece, ignora conceptos ajenos al plan y devuelve null si nadie los registra', () => {
    expect(pickAnchorModule(['a'], rows)).toBe('m1');
    expect(pickAnchorModule(['no-existe'], rows)).toBeNull();
    expect(pickAnchorModule([], rows)).toBeNull();
    expect(pickAnchorModule(['a'], [])).toBeNull();
  });
  it('cuenta conceptos distintos, no filas repetidas', () => {
    expect(pickAnchorModule(['a', 'b'], [{ module_id: 'm1', tag: 'a' }, { module_id: 'm1', tag: 'a' }, { module_id: 'm2', tag: 'a' }, { module_id: 'm2', tag: 'b' }])).toBe('m2');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Acciones de servidor, con una base simulada por tablas.
// ---------------------------------------------------------------------------------------------------------------------
let tables: Record<string, any[]> = {};
let user: { id: string } | null = { id: 't1' };
const inserts: { table: string; rows: any[] }[] = [];

function makeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from(table: string) {
      const filters: any[] = [];
      let order = false;
      const rowsNow = () => (tables[table] ?? []).filter((r) => filters.every((f) => (f.op === 'eq' ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col]))));
      const b: any = {
        select: () => b,
        eq: (col: string, val: unknown) => (filters.push({ op: 'eq', col, val }), b),
        in: (col: string, val: unknown[]) => (filters.push({ op: 'in', col, val }), b),
        order: () => ((order = true), b),
        range: (from: number, to: number) => Promise.resolve({ data: rowsNow().slice(from, to + 1), error: null }),
        maybeSingle: async () => ({ data: rowsNow()[0] ?? null, error: null }),
        single: async () => ({ data: rowsNow()[0] ?? null, error: null }),
        insert: async (rows: any[]) => {
          inserts.push({ table, rows });
          tables[table] = [...(tables[table] ?? []), ...rows];
          return { error: null };
        },
        then: (resolve: (v: any) => void) => resolve({ data: rowsNow(), error: null }),
      };
      void order;
      return b;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => makeSupabase() }));

const lessonRows = (student: string, ok: number, module = 'm1', prefix = ''): any[] =>
  Array.from({ length: 5 }, (_, i) => ({
    student_id: student,
    classroom_id: 'c1',
    module_id: module,
    question_id: `${prefix}${student}-q${i}`,
    was_correct: i < ok,
    concept_tag: `concepto_${i}`,
    attempted_at: day(1 + i),
  }));

beforeEach(() => {
  inserts.length = 0;
  user = { id: 't1' };
  tables = {
    classrooms: [{ id: 'c1', teacher_id: 't1' }],
    content_modules: [
      { id: 'm1', title: 'Grecia', classroom_id: 'c1' },
      { id: 'mX', title: 'De otra clase', classroom_id: 'c2' },
    ],
    class_enrollments: [
      { classroom_id: 'c1', student_id: 's1' },
      { classroom_id: 'c1', student_id: 's2' },
      { classroom_id: 'c1', student_id: 's3' },
    ],
    profiles: [
      { id: 's1', full_name: 'Ana', username: 'ana' },
      { id: 's2', full_name: 'Beto', username: 'beto' },
      { id: 's3', full_name: null, username: 'carla' },
    ],
    question_attempts: [...lessonRows('s1', 5), ...lessonRows('s2', 2), ...lessonRows('s3', 1)],
    remediation_plans: [],
  };
});

describe('previewModuleReinforcement', () => {
  it('lista a quien se le asignaria y sobre que conceptos, sin escribir nada', async () => {
    const { previewModuleReinforcement } = await import('@/lib/actions/module-reinforcement');
    const r = await previewModuleReinforcement('c1', 'm1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.moduleTitle).toBe('Grecia');
    expect(r.preview.assignments.map((a) => a.name)).toEqual(['Beto', 'carla']); // sin full_name usa el usuario
    expect(r.preview.assignments[0].concepts).toEqual(expect.arrayContaining(['concepto_2', 'concepto_3', 'concepto_4']));
    expect(inserts).toHaveLength(0);
  });

  it('exige ser el profesor de la clase y que el modulo sea de esa clase', async () => {
    const { previewModuleReinforcement } = await import('@/lib/actions/module-reinforcement');
    user = { id: 'otro-profesor' };
    expect(await previewModuleReinforcement('c1', 'm1')).toMatchObject({ ok: false, error: expect.stringContaining('permisos') });
    user = { id: 't1' };
    expect(await previewModuleReinforcement('c1', 'mX')).toMatchObject({ ok: false, error: expect.stringContaining('Módulo no encontrado') });
    user = null;
    expect(await previewModuleReinforcement('c1', 'm1')).toMatchObject({ ok: false, error: 'No autenticado.' });
  });
});

describe('assignModuleReinforcement', () => {
  it('crea un plan por estudiante por repasar con el formato de los planes existentes', async () => {
    const { assignModuleReinforcement } = await import('@/lib/actions/module-reinforcement');
    const r = await assignModuleReinforcement('c1', 'm1');
    expect(r).toMatchObject({ ok: true, created: 2 });
    expect(inserts).toHaveLength(1);
    const rows = inserts[0].rows;
    expect(inserts[0].table).toBe('remediation_plans');
    expect(rows.map((x) => x.student_id)).toEqual(['s2', 's3']);
    for (const row of rows) {
      expect(row).toMatchObject({ classroom_id: 'c1', created_by: 't1', status: 'active', modules_target: 5, modules_completed: 0 });
      expect(row.title.startsWith('Plan de Refuerzo: ')).toBe(true);
      expect(row.target_concepts.length).toBeGreaterThan(0);
      expect(row.target_concepts.length).toBeLessThanOrEqual(3);
    }
    // El estudiante que ya domina el modulo no recibe nada.
    expect(rows.find((x) => x.student_id === 's1')).toBeUndefined();
  });

  it('es idempotente: repetir el clic no apila planes (quien ya tiene uno activo se omite)', async () => {
    const { assignModuleReinforcement } = await import('@/lib/actions/module-reinforcement');
    await assignModuleReinforcement('c1', 'm1');
    const again = await assignModuleReinforcement('c1', 'm1');
    expect(again).toMatchObject({ ok: true, created: 0 });
    if (again.ok) expect(again.skipped.map((s) => s.reason)).toEqual(['active_plan', 'active_plan']);
    expect(inserts).toHaveLength(1); // la segunda llamada no inserto nada
  });

  it('no crea nada si no es el profesor de la clase', async () => {
    const { assignModuleReinforcement } = await import('@/lib/actions/module-reinforcement');
    user = { id: 'otro-profesor' };
    expect(await assignModuleReinforcement('c1', 'm1')).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it('no recibe estudiantes ni conceptos del navegador: solo clase y modulo', async () => {
    const { assignModuleReinforcement } = await import('@/lib/actions/module-reinforcement');
    expect(assignModuleReinforcement.length).toBe(2);
  });

  it('una clase sin estudiantes o sin nadie por repasar crea 0 sin error', async () => {
    const { assignModuleReinforcement } = await import('@/lib/actions/module-reinforcement');
    tables.class_enrollments = [];
    expect(await assignModuleReinforcement('c1', 'm1')).toMatchObject({ ok: true, created: 0 });
    tables.class_enrollments = [{ classroom_id: 'c1', student_id: 's1' }]; // solo Ana, que domina
    expect(await assignModuleReinforcement('c1', 'm1')).toMatchObject({ ok: true, created: 0 });
    expect(inserts).toHaveLength(0);
  });
});

describe('«Dónde intervenir» ofrece asignar refuerzo', () => {
  it('cada modulo con estudiantes por repasar trae su boton; sin nadie por repasar no hay boton', () => {
    const students = [{ id: 's1', name: 'Ana' }];
    const modules = [{ id: 'm1', title: 'Grecia', objectiveId: null }];
    const bad = Array.from({ length: 5 }, (_, i) => ({ student_id: 's1', module_id: 'm1', question_id: `q${i}`, was_correct: false, attempted_at: day(1) }));
    const good = bad.map((a) => ({ ...a, was_correct: true }));
    const withReview = renderToStaticMarkup(h(ClassMasteryView, { classroomId: 'c1', mastery: buildClassMastery({ modules, objectives: [], students, attempts: bad }) }));
    expect(withReview).toContain('Asignar refuerzo');
    const none = renderToStaticMarkup(h(ClassMasteryView, { classroomId: 'c1', mastery: buildClassMastery({ modules, objectives: [], students, attempts: good }) }));
    expect(none).not.toContain('Asignar refuerzo');
  });
});
