import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MASTERY_LABELS,
  MASTERY_THRESHOLD,
  MIN_EVIDENCE,
  groupAttemptsByModule,
  masteryDetail,
  moduleMastery,
  objectiveState,
  rollupMastery,
  type AttemptLite,
} from './mastery';
import { loadModuleAttempts } from './load';
import { MasteryBadge } from '@/components/student/MasteryBadge';
import { MasterySummary } from '@/components/student/MasterySummary';

const at = (day: number, hour = 12) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
const a = (question_id: string, was_correct: boolean, day = 1, hour = 12): AttemptLite => ({ question_id, was_correct, attempted_at: at(day, hour) });
// n preguntas distintas, las primeras `ok` bien.
const batch = (n: number, ok: number): AttemptLite[] => Array.from({ length: n }, (_, i) => a(`q${i}`, i < ok));

describe('moduleMastery', () => {
  it('sin respuestas: sin empezar', () => {
    expect(moduleMastery([])).toEqual({ state: 'not_started', answered: 0, correct: 0, ratio: null });
  });

  it('con menos preguntas de las de una leccion: en progreso, aunque acierte todo (poca evidencia)', () => {
    const m = moduleMastery(batch(MIN_EVIDENCE - 1, MIN_EVIDENCE - 1));
    expect(m).toMatchObject({ state: 'in_progress', answered: MIN_EVIDENCE - 1, correct: MIN_EVIDENCE - 1 });
  });

  it('con una leccion completa y 4 de 5 bien: dominado (80 % es el umbral)', () => {
    expect(MASTERY_THRESHOLD).toBe(0.8);
    expect(moduleMastery(batch(5, 4))).toMatchObject({ state: 'mastered', ratio: 0.8 });
    expect(moduleMastery(batch(5, 5)).state).toBe('mastered');
  });

  it('con una leccion completa y 3 de 5 bien: por repasar', () => {
    expect(moduleMastery(batch(5, 3))).toMatchObject({ state: 'needs_review', correct: 3, answered: 5 });
    expect(moduleMastery(batch(10, 0)).state).toBe('needs_review');
  });

  it('de cada pregunta cuenta solo la ULTIMA vez: fallar y luego acertar ya es dominio', () => {
    const attempts = [...batch(5, 3), a('q3', true, 5), a('q4', true, 6)]; // q3 y q4 estaban mal y luego bien
    expect(moduleMastery(attempts)).toMatchObject({ state: 'mastered', answered: 5, correct: 5 });
  });

  it('y al reves: acertar y luego fallar baja el dominio, sin importar el orden en que lleguen los datos', () => {
    // Dos fallos recientes sobre 5 preguntas antes acertadas: 3 de 5 = 60 %. Vienen PRIMERO en la lista a proposito.
    const attempts = [a('q0', false, 9), a('q1', false, 9), ...batch(5, 5)];
    expect(moduleMastery(attempts)).toMatchObject({ state: 'needs_review', correct: 3, answered: 5 });
    expect(moduleMastery([...attempts].reverse())).toMatchObject({ state: 'needs_review', correct: 3 });
  });

  it('el desempate entre intentos usa la fecha, no la posicion', () => {
    const early = a('q', true, 1, 8);
    const late = a('q', false, 1, 20);
    expect(moduleMastery([early, late]).correct).toBe(0);
    expect(moduleMastery([late, early]).correct).toBe(0);
  });
});

describe('agrupar, sumar y estado por objetivo', () => {
  it('agrupa los intentos por modulo', () => {
    const g = groupAttemptsByModule([
      { module_id: 'm1', ...a('q1', true) },
      { module_id: 'm2', ...a('q2', false) },
      { module_id: 'm1', ...a('q3', true) },
    ]);
    expect(g.get('m1')).toHaveLength(2);
    expect(g.get('m2')).toHaveLength(1);
    expect(g.get('m3')).toBeUndefined();
  });

  it('rollup cuenta cada estado', () => {
    expect(rollupMastery(['mastered', 'mastered', 'needs_review', 'not_started'])).toEqual({ total: 4, mastered: 2, needs_review: 1, in_progress: 0, not_started: 1 });
  });

  it('objetivo: dominado solo si todos los modulos lo estan; por repasar si alguno lo necesita', () => {
    expect(objectiveState([])).toBe('not_started');
    expect(objectiveState(['not_started', 'not_started'])).toBe('not_started');
    expect(objectiveState(['mastered', 'mastered'])).toBe('mastered');
    expect(objectiveState(['mastered', 'needs_review', 'not_started'])).toBe('needs_review');
    expect(objectiveState(['mastered', 'in_progress'])).toBe('in_progress');
    expect(objectiveState(['mastered', 'not_started'])).toBe('in_progress');
  });

  it('las frases traen el conteo real', () => {
    expect(masteryDetail(moduleMastery(batch(5, 4)))).toBe('4 de 5 bien');
    expect(masteryDetail(moduleMastery(batch(5, 2)))).toContain('2 de 5 bien');
    expect(masteryDetail(moduleMastery(batch(2, 1)))).toContain(`con ${MIN_EVIDENCE} preguntas`);
    expect(MASTERY_LABELS.needs_review).toBe('Por repasar');
  });
});

function fakeDb(rows: any[], opts: { error?: boolean } = {}) {
  const filters: any[] = [];
  const b: any = {
    select: () => b,
    order: () => b,
    limit: () => b,
    eq: (col: string, val: unknown) => (filters.push([col, val]), b),
    then: (resolve: (v: any) => void) =>
      resolve(opts.error ? { data: null, error: { message: 'boom' } } : { data: rows.filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
  };
  return { db: { from: () => b }, filters };
}

describe('loadModuleAttempts', () => {
  const rows = [
    { student_id: 's1', classroom_id: 'c1', module_id: 'm1', ...a('q1', true) },
    { student_id: 's1', classroom_id: 'c1', module_id: 'm1', ...a('q2', false) },
    { student_id: 's2', classroom_id: 'c1', module_id: 'm1', ...a('q9', true) },
    { student_id: 's1', classroom_id: 'c2', module_id: 'm7', ...a('q8', true) },
  ];

  it('solo toma los intentos de ESE estudiante en ESA clase y los agrupa por modulo', async () => {
    const { db, filters } = fakeDb(rows);
    const g = await loadModuleAttempts(db, { studentId: 's1', classroomId: 'c1' });
    expect(filters).toEqual(expect.arrayContaining([['student_id', 's1'], ['classroom_id', 'c1']]));
    expect(Array.from(g.keys())).toEqual(['m1']);
    expect(g.get('m1')).toHaveLength(2);
  });

  it('propaga los errores de la base', async () => {
    await expect(loadModuleAttempts(fakeDb([], { error: true }).db, { studentId: 's1', classroomId: 'c1' })).rejects.toThrow('boom');
  });
});

describe('interfaz', () => {
  it('la insignia dice el estado con texto y conteo, y un modulo sin empezar no muestra nada', () => {
    const html = renderToStaticMarkup(h(MasteryBadge, { mastery: moduleMastery(batch(5, 3)) }));
    expect(html).toContain('Por repasar');
    expect(html).toContain('3 de 5 bien');
    expect(renderToStaticMarkup(h(MasteryBadge, { mastery: moduleMastery([]) }))).toBe('');
  });

  const mods = [
    { id: 'm1', objectiveId: 'o1', state: 'mastered' as const },
    { id: 'm2', objectiveId: 'o1', state: 'needs_review' as const },
    { id: 'm3', objectiveId: null, state: 'not_started' as const },
  ];

  it('el resumen describe la barra en texto (no depende del color) y ofrece practicar si hay algo por repasar', () => {
    const html = renderToStaticMarkup(h(MasterySummary, { modules: mods, objectives: [{ id: 'o1', title: 'Equilibrio de mercado' }], practiceHref: '/my-classes/c1/practice' }));
    expect(html).toContain('role="img"');
    expect(html).toContain('1 dominado, 1 por repasar, 0 en progreso, 1 sin empezar');
    expect(html).toContain('Tienes 1 módulo por repasar');
    expect(html).toContain('href="/my-classes/c1/practice"');
    expect(html).toContain('Equilibrio de mercado');
    expect(html).toContain('1 de 2 módulos dominados');
    expect(html).toContain('role="region"');
  });

  it('sin practica disponible no ofrece el enlace; objetivos sin modulos no aparecen', () => {
    const html = renderToStaticMarkup(h(MasterySummary, { modules: mods, objectives: [{ id: 'o1', title: 'A' }, { id: 'o2', title: 'Sin modulos' }], practiceHref: null }));
    expect(html).not.toContain('/practice');
    expect(html).not.toContain('Sin modulos');
  });

  it('si no ha empezado nada, no se muestra', () => {
    const html = renderToStaticMarkup(h(MasterySummary, { modules: [{ id: 'm', objectiveId: null, state: 'not_started' }], objectives: [] }));
    expect(html).toBe('');
    expect(renderToStaticMarkup(h(MasterySummary, { modules: [], objectives: [] }))).toBe('');
  });
});
