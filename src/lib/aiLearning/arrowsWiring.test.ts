import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createMergedDraft } from './playbookDraft';
import { loadClassroomCalibration } from './calibrationLoader';
import type { FeedbackEvent } from './judgeCalibration';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n');

// Cliente falso minimo de Supabase para createMergedDraft.
function fakeDb(opts: { activeRules?: unknown; lastVersion?: number; insertError?: string }) {
  const inserted: any[] = [];
  const db = {
    inserted,
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => (table === 'ai_playbooks' && !q._ver ? { data: opts.activeRules ? { rules: opts.activeRules } : null } : { data: opts.lastVersion ? { version: opts.lastVersion } : null }),
        insert: async (row: any) => {
          inserted.push(row);
          return { error: opts.insertError ? { message: opts.insertError } : null };
        },
      };
      // La segunda consulta (ultima version) se distingue por el order().
      q.order = () => {
        q._ver = true;
        return q;
      };
      return q;
    },
  };
  return db;
}

describe('createMergedDraft', () => {
  it('crea SIEMPRE un borrador (nunca activo), con el origen pedido, la nota y las reglas actuales primero', async () => {
    const db = fakeDb({ activeRules: [{ text: 'Regla activa del profesor' }], lastVersion: 3 });
    const r = await createMergedDraft(db, 'c1', [{ text: 'Regla propuesta por la IA', evidence: '9 de 40' }], 'Nota', 'ai');
    expect(r).toMatchObject({ ok: true, version: 4, added: 1 });
    const row = db.inserted[0];
    expect(row.status).toBe('draft');
    expect(row.origin).toBe('ai');
    expect(row.rules.map((x: any) => x.text)).toEqual(['Regla activa del profesor', 'Regla propuesta por la IA']);
    expect(row.rules[1].evidence).toBe('9 de 40');
  });
  it('no crea nada si las reglas ya estan o si no hay reglas, y devuelve el error de la base', async () => {
    const ya = fakeDb({ activeRules: [{ text: 'Regla ya presente en el cuaderno' }] });
    expect(await createMergedDraft(ya, 'c1', [{ text: 'regla ya presente en el cuaderno' }], 'n', 'ai')).toMatchObject({ ok: false });
    expect(ya.inserted).toHaveLength(0);
    expect(await createMergedDraft(fakeDb({}), 'c1', [], 'n', 'ai')).toMatchObject({ ok: false });
    expect(await createMergedDraft(fakeDb({ insertError: 'rls' }), 'c1', [{ text: 'Una regla nueva suficientemente larga' }], 'n', 'ai')).toEqual({ ok: false, error: 'rls' });
  });
  it('respeta el tope de 10 reglas', async () => {
    const db = fakeDb({ activeRules: Array.from({ length: 10 }, (_, i) => ({ text: `Regla existente numero ${i}` })) });
    expect((await createMergedDraft(db, 'c1', [{ text: 'Regla nueva que no cabe' }], 'n', 'ai')).ok).toBe(false);
  });
});

describe('loadClassroomCalibration', () => {
  const ev = (q: string, signal: FeedbackEvent['signal'], verdict: FeedbackEvent['verdict'], t: number, reason: string | null = null): FeedbackEvent => ({ question_id: q, signal, verdict, reason, created_at: new Date(2026, 10, 1, 0, 0, t).toISOString() });
  const dbWith = (rows: FeedbackEvent[] | null, error = false) => ({ from: () => ({ select: () => ({ eq: () => ({ range: async () => (error ? { data: null, error: { message: 'x' } } : { data: rows, error: null }) }) }) }) });
  it('sin cliente o ante cualquier fallo devuelve null (no se actua sobre lo que no se pudo medir)', async () => {
    expect(await loadClassroomCalibration(null, 'c1')).toBeNull();
    expect(await loadClassroomCalibration(dbWith(null, true), 'c1')).toBeNull();
    expect(await loadClassroomCalibration({ from: () => { throw new Error('boom'); } }, 'c1')).toBeNull();
  });
  it('con eventos calcula la calibracion', async () => {
    const rows = [ev('a', 'judge', 'approved', 1), ev('a', 'teacher', 'rejected', 2)];
    const c = await loadClassroomCalibration(dbWith(rows), 'c1');
    expect(c?.pairs).toBe(1);
    expect(c?.falsePass).toBe(1);
    expect(c?.status).toBe('insufficient');
  });
});

describe('cableado del interruptor del juez', () => {
  const src = read('src/lib/actions/learning-objectives.ts');
  it('solo se lee la calibracion con llave de servicio y DESPUES de comprobar que la clase es del profesor', () => {
    const iOwn = src.indexOf(".eq('teacher_id', user.id)");
    const iLoad = src.indexOf('loadClassroomCalibration(createAdminSupabase()');
    expect(iOwn).toBeGreaterThan(-1);
    expect(iOwn).toBeLessThan(iLoad);
  });
  it('el interruptor actua SOLO sobre lo aprobado: lo aprobado se cuenta unicamente si no esta guardado', () => {
    const bloque = src.slice(src.indexOf("if (result.verdict === 'pass') {"), src.indexOf("} else if (result.verdict === 'fail')"));
    expect(bloque).toContain("guardVerdict('pass', calibration)");
    expect(bloque).toMatch(/if \(guard\.guarded\) \{[\s\S]*human_review[\s\S]*\} else \{[\s\S]*approved\+\+/);
  });
  it('un veredicto sin calibracion o con un fallo de lectura no cambia el comportamiento (calibration queda null)', () => {
    expect(src).toContain('let calibration = null;');
  });
});

describe('las propuestas de la IA nunca activan nada', () => {
  const pb = read('src/lib/actions/playbook.ts');
  const cy = read('src/lib/actions/cycles.ts');
  const draft = read('src/lib/aiLearning/playbookDraft.ts');
  it('crear un borrador es lo unico que se escribe y siempre con status draft', () => {
    expect(draft).toContain("status: 'draft'");
    expect(draft).not.toContain("status: 'active'");
  });
  it('proponer desde rechazos comprueba la propiedad antes de leer y crea el borrador con origen ai', () => {
    const f = pb.slice(pb.indexOf('export async function proposeRulesFromRejections'));
    expect(f.indexOf(".eq('teacher_id', user.id)")).toBeLessThan(f.indexOf("from('lesson_questions')"));
    expect(f).toContain("'ai')");
    expect(f).not.toContain('activatePlaybook');
  });
  it('agregar una sugerencia al cuaderno exige propiedad y que este ACEPTADA (ruleFromSuggestion), y no la acepta por el profesor', () => {
    const f = cy.slice(cy.indexOf('export async function addSuggestionToPlaybook'));
    expect(f).toContain('requireOwner(classroomId)');
    expect(f).toContain('ruleFromSuggestion(s)');
    expect(f).not.toMatch(/status:\s*'accepted'/);
  });
});

describe('pantallas', () => {
  it('la revision lee las estadisticas (tabla de servidor) solo tras comprobar la propiedad, y retirar es decision del profesor', () => {
    const page = read('src/app/(teacher)/teacher/classrooms/[id]/review/page.tsx');
    expect(page.indexOf(".eq('teacher_id', user.id)")).toBeLessThan(page.indexOf("from('question_stats')"));
    const card = read('src/app/(teacher)/teacher/classrooms/[id]/review/FlaggedCard.tsx');
    expect(card).toContain('rejectReviewQuestion');
    expect(card).toContain('La IA solo las señala');
  });
  it('el cuaderno ofrece proponer reglas y muestra la evidencia; la retrospectiva ofrece agregar lo aceptado', () => {
    expect(read('src/app/(teacher)/teacher/classrooms/[id]/playbook/PlaybookClient.tsx')).toContain('proposeRulesFromRejections');
    expect(read('src/app/(teacher)/teacher/classrooms/[id]/playbook/PlaybookClient.tsx')).toContain('Evidencia:');
    expect(read('src/app/(teacher)/teacher/classrooms/[id]/cycles/CyclesClient.tsx')).toContain("s.status === 'accepted' && s.kind === 'reinforce_concept'");
  });
});
