import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getLabTemplate } from './labTemplates';
import { rowToItem, sortItems, specToFields, type LabRow } from './labRows';
import { cleanQuestions, effectiveVariable, limitHint, normalizeDraft, questionError, withConstant, withIndependent, withMode, withVariable } from './labEditor';
import { defaultSpec } from './labSpec';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

const GOOD = {
  template: 'trayectoria',
  title: 'El mejor ángulo para lanzar una jabalina',
  objective: '¿Qué ángulo da el mayor alcance si la velocidad y la altura no cambian?',
  context: 'Un equipo de atletismo quiere entrenar mejor.',
  hypothesisPrompt: 'Antes de lanzar: ¿qué ángulo crees que dará más alcance y por qué?',
  independent: 'angulo',
  mode: 'controlado',
  variables: { v0: { min: 10, max: 40, default: 25 }, h0: { default: 0 }, angulo: { min: 10, max: 80 } },
  constants: { g: 9.81 },
  minTrials: 5,
  questions: ['¿Qué ángulo te dio el mayor alcance? Apóyate en tu tabla.', '¿Qué pasa con ángulos complementarios como 30° y 60°?', '¿Cómo cambiaría con otra gravedad?'],
};

// ─────────────────────────── filas de la base ───────────────────────────
describe('rowToItem: lo guardado se vuelve a validar al leerlo', () => {
  const row = (over: Partial<LabRow> = {}): LabRow => ({
    id: 'a1', classroom_id: 'c1', teacher_id: 't1', title: 'Mi lab', template: 'trayectoria', spec: GOOD, source_material_id: null, status: 'draft',
    created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', published_at: null, ...over,
  });

  it('una fila buena da la ficha, el laboratorio listo y los datos de la plantilla', () => {
    const it = rowToItem(row());
    expect(it.spec?.template).toBe('trayectoria');
    expect(it.lab?.variables.find((v) => v.id === 'angulo')?.locked).toBe(false);
    expect(it.templateName).toBe('Lanzamiento de proyectiles');
    expect(it.area).toBe('fisica');
    expect(it.areaLabel).toBe('Física');
  });

  it('una plantilla retirada no rompe la lista: se marca y la ficha queda en null', () => {
    const it = rowToItem(row({ template: 'retirada', spec: { ...GOOD, template: 'retirada' } }));
    expect(it.spec).toBeNull();
    expect(it.lab).toBeNull();
    expect(it.areaLabel).toBe('Plantilla retirada');
    expect(it.templateName).toBe('retirada');
  });

  it('un spec corrupto (null, lista, texto, numero) no rompe nada', () => {
    for (const spec of [null, [], 'x', 5, undefined]) {
      const it = rowToItem(row({ spec }));
      expect(it.spec, String(spec)).toBeNull();
    }
  });

  it('la plantilla de la fila manda sobre la del spec guardado', () => {
    const it = rowToItem(row({ template: 'multiplicador', spec: { ...GOOD, template: 'trayectoria', independent: 'G' } }));
    expect(it.spec?.template).toBe('multiplicador');
  });

  it('valores fuera de rango guardados por otro camino se recortan al leer', () => {
    const it = rowToItem(row({ spec: { ...GOOD, variables: { v0: { min: -5, max: 99999, default: 70000 } }, constants: { g: 1e9 }, minTrials: 500 } }));
    expect(it.spec?.variables.v0).toEqual({ min: 1, max: 60, default: 60 });
    expect(it.spec?.constants.g).toBe(25);
    expect(it.spec?.minTrials).toBe(12);
  });

  it('un estado raro se trata como borrador (nunca como publicado)', () => {
    expect(rowToItem(row({ status: 'published' })).status).toBe('published');
    expect(rowToItem(row({ status: 'admin' as never })).status).toBe('draft');
  });

  it('specToFields toma el titulo y la plantilla de la ficha validada', () => {
    const spec = defaultSpec(getLabTemplate('multiplicador')!);
    expect(specToFields(spec)).toEqual({ title: 'Multiplicador keynesiano', template: 'multiplicador', spec });
  });

  it('sortItems: publicados primero, y dentro de cada grupo el mas reciente', () => {
    const mk = (id: string, status: 'draft' | 'published', at: string) => rowToItem(row({ id, status, updated_at: at }));
    const out = sortItems([mk('d-viejo', 'draft', '2026-01-01T00:00:00Z'), mk('p-viejo', 'published', '2026-01-02T00:00:00Z'), mk('d-nuevo', 'draft', '2026-03-01T00:00:00Z'), mk('p-nuevo', 'published', '2026-02-01T00:00:00Z')]);
    expect(out.map((i) => i.id)).toEqual(['p-nuevo', 'p-viejo', 'd-nuevo', 'd-viejo']);
  });
});

// ─────────────────────────── el editor ───────────────────────────
describe('ayudantes del editor', () => {
  const base = defaultSpec(getLabTemplate('trayectoria')!);

  it('withVariable / withConstant / withIndependent / withMode no mutan la ficha original', () => {
    const copy = JSON.stringify(base);
    const a = withMode(withIndependent(withConstant(withVariable(base, 'v0', { min: 5 }), 'g', 1.62), 'v0'), 'libre');
    expect(JSON.stringify(base)).toBe(copy);
    expect(a.variables.v0).toEqual({ min: 5 });
    expect(a.constants.g).toBe(1.62);
    expect(a.independent).toBe('v0');
    expect(a.mode).toBe('libre');
  });

  it('withVariable fusiona con lo que ya habia', () => {
    const a = withVariable(withVariable(base, 'v0', { min: 5 }), 'v0', { max: 30 });
    expect(a.variables.v0).toEqual({ min: 5, max: 30 });
  });

  it('effectiveVariable muestra el valor ya recortado a los limites de la plantilla', () => {
    expect(effectiveVariable(withVariable(base, 'v0', { min: -10, max: 500, default: 999 }), 'v0')).toEqual({ min: 1, max: 60, default: 60 });
    expect(effectiveVariable(base, 'angulo')).toEqual({ min: 5, max: 85, default: 45 });
    expect(effectiveVariable(base, 'nada')).toBeNull();
  });

  it('questionError: vacia es valida (se quita), corta y larga no', () => {
    expect(questionError('')).toBeNull();
    expect(questionError('   ')).toBeNull();
    expect(questionError('corta')).toMatch(/al menos 8/);
    expect(questionError('¿Qué pasa con el alcance?')).toBeNull();
    expect(questionError('x'.repeat(300))).toMatch(/Máximo 240/);
  });

  it('cleanQuestions quita vacias, normaliza espacios y deja como maximo 6', () => {
    expect(cleanQuestions(['  ¿Una   pregunta?  ', '', '   ', '¿Otra pregunta?'])).toEqual(['¿Una pregunta?', '¿Otra pregunta?']);
    expect(cleanQuestions(Array.from({ length: 10 }, (_, i) => `pregunta ${i}`))).toHaveLength(6);
  });

  it('normalizeDraft devuelve la ficha validada, el laboratorio y los avisos de lo que ajusto', () => {
    const n = normalizeDraft(withConstant(base, 'g', 500))!;
    expect(n.spec.constants.g).toBe(25);
    expect(n.warnings.length).toBe(1);
    expect(n.lab.constants[0].value).toBe(25);
    expect(normalizeDraft({ ...base, template: 'nada' })).toBeNull();
  });

  it('limitHint dice el limite de la plantilla', () => {
    expect(limitHint({ template: 'trayectoria' }, 'v0')).toBe('Límite de la plantilla: de 1 a 60 m/s');
    expect(limitHint({ template: 'multiplicador' }, 'c')).toBe('Límite de la plantilla: de 0,3 a 0,95');
    expect(limitHint({ template: 'trayectoria' }, 'nada')).toBe('');
  });
});

// ─────────────────────────── seguridad: base de datos y API ───────────────────────────
describe('migracion 078 (labs)', () => {
  const sql = read('supabase/migrations/078_labs.sql');

  it('crea la tabla con RLS y los controles de forma', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.labs');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain(String.raw`'^[a-z][a-z0-9-]{0,31}$'`);
    expect(sql).toContain("jsonb_typeof(spec) = 'object'");
    expect(sql).toContain('pg_column_size(spec) < 20000');
    expect(sql).toContain("CHECK (status IN ('draft', 'published'))");
    expect(sql).toContain('REFERENCES public.classrooms(id) ON DELETE CASCADE');
  });

  it('el profesor solo gestiona lo suyo: ver, crear, editar y borrar', () => {
    for (const p of ['labs_teacher_select', 'labs_teacher_insert', 'labs_teacher_update', 'labs_teacher_delete']) expect(sql).toContain(p);
    expect((sql.match(/teacher_id = auth\.uid\(\)/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(sql).toContain("p.role IN ('teacher', 'admin')");
  });

  it('un laboratorio solo se puede vincular a un material PROPIO (no al de otro profesor)', () => {
    expect((sql.match(/source_material_id IS NULL OR EXISTS \(SELECT 1 FROM public\.teaching_materials m WHERE m\.id = source_material_id AND m\.teacher_id = auth\.uid\(\)\)/g) ?? []).length).toBe(2);
  });

  it('el estudiante SOLO puede leer los publicados de sus clases: nada de escribir', () => {
    expect(sql).toContain('labs_student_select');
    expect(sql).toMatch(/labs_student_select ON public\.labs\s+FOR SELECT USING \(\s+status = 'published'/);
    expect(sql).toContain('class_enrollments e WHERE e.student_id = auth.uid()');
    const studentLines = sql.split('\n').filter((l) => /labs_student_/.test(l));
    for (const l of studentLines) expect(l).not.toMatch(/INSERT|UPDATE|DELETE|ALL/);
    expect(sql).not.toMatch(/CREATE POLICY labs_student_(insert|update|delete|all)/);
  });

  it('actualiza updated_at con el trigger de siempre', () => {
    expect(sql).toContain('EXECUTE PROCEDURE public.update_updated_at()');
  });
});
