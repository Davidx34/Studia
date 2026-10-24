import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildPracticeQueue, toPracticeQuestion, PRACTICE_SIZE } from './session';
import { loadPracticeQuestions } from './load';

const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`;
const att = (question_id: string, was_correct: boolean, day: number) => ({ question_id, was_correct, attempted_at: at(day) });
const noShuffle = () => 0.999999; // con este rng el mezclado deja el orden como esta

describe('buildPracticeQueue', () => {
  it('sin intentos no hay nada que practicar', () => {
    expect(buildPracticeQueue([])).toEqual({ ids: [], answeredTotal: 0, wrongTotal: 0 });
  });

  it('cuenta el ULTIMO intento de cada pregunta: lo que fallo antes y ya acerto no vuelve como fallo', () => {
    const q = buildPracticeQueue([att('a', false, 1), att('a', true, 5), att('b', true, 2), att('b', false, 6)], { rng: noShuffle });
    expect(q.answeredTotal).toBe(2);
    expect(q.wrongTotal).toBe(1);
    expect(q.ids[0]).toBe('b'); // la fallada va primero
  });

  it('primero las falladas, luego las acertadas empezando por la que hace MAS tiempo que no ve', () => {
    const q = buildPracticeQueue([att('ok-nueva', true, 20), att('fallo', false, 10), att('ok-vieja', true, 3)], { rng: noShuffle });
    expect(q.ids).toEqual(['fallo', 'ok-vieja', 'ok-nueva']);
  });

  it('respeta el tamano y no repite preguntas', () => {
    const many = Array.from({ length: 30 }, (_, i) => att(`q${i}`, i % 2 === 0, (i % 28) + 1));
    const q = buildPracticeQueue(many, { size: 5 });
    expect(q.ids).toHaveLength(5);
    expect(new Set(q.ids).size).toBe(5);
    expect(buildPracticeQueue(many).ids).toHaveLength(PRACTICE_SIZE);
    expect(q.answeredTotal).toBe(30);
  });

  it('mezcla las falladas con el generador dado (reproducible)', () => {
    const wrong = ['a', 'b', 'c', 'd'].map((id, i) => att(id, false, i + 1));
    const seq = [0.1, 0.9, 0.3];
    let i = 0;
    const rng = () => seq[i++ % seq.length];
    const a = buildPracticeQueue(wrong, { rng }).ids;
    i = 0;
    expect(buildPracticeQueue(wrong, { rng }).ids).toEqual(a);
    expect([...a].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('toPracticeQuestion', () => {
  it('acepta los cinco tipos clasicos con su clave', () => {
    expect(toPracticeQuestion({ id: '1', type: 'multiple_choice', q: 'P', opts: ['A. x', 'B. y'], ok: 1, exp: 'porque' })).toMatchObject({ type: 'multiple_choice', ok: 1, exp: 'porque' });
    expect(toPracticeQuestion({ id: '2', type: 'true_false', q: 'P', ok: false })).toMatchObject({ ok: false });
    expect(toPracticeQuestion({ id: '3', type: 'fill_blank', q: 'La ___', answers: ['x'] })).toMatchObject({ answers: ['x'] });
    expect(toPracticeQuestion({ id: '4', type: 'short_answer', q: 'P', keywords: ['k'] })).toMatchObject({ keywords: ['k'] });
    expect(toPracticeQuestion({ id: '5', type: 'match', q: 'P', pairs: [{ term: 'a', def: 'b' }, { term: 'c', def: 'd' }] })).toMatchObject({ type: 'match' });
  });

  it('descarta minijuegos, tipos desconocidos y filas incompletas', () => {
    expect(toPracticeQuestion({ id: '1', type: 'el_descifrador', q: 'P' })).toBeNull();
    expect(toPracticeQuestion({ id: '2', type: 'multiple_choice', q: 'P', opts: ['A', 'B'], ok: 7 })).toBeNull(); // clave fuera de rango
    expect(toPracticeQuestion({ id: '3', type: 'multiple_choice', q: 'P', opts: [], ok: 0 })).toBeNull();
    expect(toPracticeQuestion({ id: '4', type: 'match', q: 'P', pairs: [{ term: 'a', def: 'b' }] })).toBeNull(); // un solo par
    expect(toPracticeQuestion({ id: '5', type: 'fill_blank', q: 'La ___', answers: [] })).toBeNull();
    expect(toPracticeQuestion(null)).toBeNull();
  });

  it('una explicacion vacia queda en null', () => {
    expect(toPracticeQuestion({ id: '1', type: 'true_false', q: 'P', ok: true, exp: '   ' })!.exp).toBeNull();
  });
});

// Base simulada: registra los filtros de cada consulta y devuelve las filas que cumplen eq / is / in.
function fakeDb(tables: Record<string, any[]>, calls: { table: string; filters: any[] }[], failTable?: string) {
  return {
    from(table: string) {
      const call = { table, filters: [] as any[] };
      calls.push(call);
      const b: any = {
        select: () => b,
        order: () => b,
        limit: () => b,
        eq: (col: string, val: unknown) => (call.filters.push({ op: 'eq', col, val }), b),
        is: (col: string, val: unknown) => (call.filters.push({ op: 'is', col, val }), b),
        in: (col: string, val: unknown[]) => (call.filters.push({ op: 'in', col, val }), b),
        then: (resolve: (v: any) => void) => {
          if (table === failTable) return resolve({ data: null, error: { message: 'boom' } });
          const rows = (tables[table] ?? []).filter((r) =>
            call.filters.every((f) => (f.op === 'eq' ? r[f.col] === f.val : f.op === 'is' ? (r[f.col] ?? null) === f.val : f.val.includes(r[f.col])))
          );
          return resolve({ data: rows, error: null });
        },
      };
      return b;
    },
  };
}

describe('loadPracticeQuestions', () => {
  const tables = () => ({
    question_attempts: [
      { student_id: 's1', classroom_id: 'c1', game_type: null, ...att('q-fallo', false, 5) },
      { student_id: 's1', classroom_id: 'c1', game_type: null, ...att('q-ok', true, 2) },
      { student_id: 's1', classroom_id: 'c1', game_type: 'timeline', ...att('q-minijuego', true, 3) },
      { student_id: 's2', classroom_id: 'c1', game_type: null, ...att('q-de-otro', true, 4) },
      { student_id: 's1', classroom_id: 'c2', game_type: null, ...att('q-otra-clase', true, 4) },
    ],
    lesson_questions: [
      { id: 'q-ok', type: 'true_false', q: 'Verdad', ok: true, exp: null },
      { id: 'q-fallo', type: 'fill_blank', q: 'La ___', answers: ['x'], exp: 'e' },
      { id: 'q-sin-ver', type: 'true_false', q: 'Nunca la respondio', ok: false },
      { id: 'q-roto', type: 'multiple_choice', q: 'P', opts: [], ok: 0 },
    ],
  });

  it('solo toma SUS intentos de ESA clase y de preguntas clasicas (sin minijuegos)', async () => {
    const calls: any[] = [];
    const data = await loadPracticeQuestions(fakeDb(tables(), calls), { studentId: 's1', classroomId: 'c1' });
    expect(calls[0].table).toBe('question_attempts');
    expect(calls[0].filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', col: 'student_id', val: 's1' },
        { op: 'eq', col: 'classroom_id', val: 'c1' },
        { op: 'is', col: 'game_type', val: null },
      ])
    );
    // Lo de otro estudiante, de otra clase o de un minijuego no entra en la cuenta.
    expect(data.answeredTotal).toBe(2);
  });

  it('pide las claves SOLO de las preguntas que ya respondio y devuelve la fallada primero', async () => {
    const calls: any[] = [];
    const data = await loadPracticeQuestions(fakeDb(tables(), calls), { studentId: 's1', classroomId: 'c1' });
    const idFilter = calls[1].filters.find((f: any) => f.col === 'id');
    expect([...idFilter.val].sort()).toEqual(['q-fallo', 'q-ok']);
    expect(idFilter.val).not.toContain('q-sin-ver');
    expect(data.questions.map((q) => q.id)).toEqual(['q-fallo', 'q-ok']);
    expect(data).toMatchObject({ answeredTotal: 2, wrongTotal: 1 });
  });

  it('sin intentos no pide ninguna clave', async () => {
    const calls: any[] = [];
    const data = await loadPracticeQuestions(fakeDb({ question_attempts: [], lesson_questions: [] }, calls), { studentId: 's1', classroomId: 'c1' });
    expect(data.questions).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('descarta las filas que no sirven y propaga los errores de la base', async () => {
    const t = tables();
    t.question_attempts.push({ student_id: 's1', classroom_id: 'c1', game_type: null, ...att('q-roto', true, 6) });
    const data = await loadPracticeQuestions(fakeDb(t, []), { studentId: 's1', classroomId: 'c1' });
    expect(data.questions.map((q) => q.id)).not.toContain('q-roto');
    await expect(loadPracticeQuestions(fakeDb(tables(), [], 'question_attempts'), { studentId: 's1', classroomId: 'c1' })).rejects.toThrow('boom');
  });
});

// La practica NO registra nada: no cuenta para la racha (que la dispara question_attempts / student_card_state), ni para el
// profesor, ni da monedas. Estas pruebas vigilan el codigo para que nadie le agregue una escritura sin darse cuenta.
describe('la practica no escribe nada', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
  const files = [
    'src/lib/practice/session.ts',
    'src/lib/practice/load.ts',
    'src/app/(student)/my-classes/[id]/practice/page.tsx',
    'src/app/(student)/my-classes/[id]/practice/PracticeClient.tsx',
  ];
  const code = (src: string) =>
    src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');

  it.each(files)('%s no inserta, actualiza ni borra', (f) => {
    const src = code(read(f));
    expect(src).not.toMatch(/\.(insert|upsert|update|delete)\(/);
    expect(src).not.toMatch(/\.rpc\(/);
  });

  it.each(files)('%s no toca la calificacion en servidor, el repaso espaciado ni la racha', (f) => {
    const src = code(read(f));
    expect(src).not.toContain('/api/lesson');
    expect(src).not.toContain('student_card_state');
    expect(src).not.toContain('lesson_attempts');
    expect(src).not.toContain('check_and_update_streak');
    expect(src).not.toContain('recordAttempt');
  });
});
