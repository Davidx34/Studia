import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { classMemoryDerivedEnabled, classNotesBlock, conceptErrorHints, derivedBlock, loadClassMemoryBlock, sanitizeNote, MAX_NOTES, MIN_CONCEPT_ERRORS } from './classMemory';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n');
const rej = (concept: string | null, reason: string, status = 'rejected') => ({ concept_tag: concept, review_status: status, review_reason: reason });

describe('notas del profesor', () => {
  it('se limpian (sin saltos de linea ni marcadores) y se exige un minimo', () => {
    expect(sanitizeNote('Mis estudiantes\nno han visto <calculo> `diferencial`')).toBe('Mis estudiantes no han visto calculo diferencial');
    expect(sanitizeNote('corta')).toBeNull();
    expect(sanitizeNote('x'.repeat(500))!.length).toBe(300);
  });
  it('el bloque deduplica, respeta el maximo y es vacio sin notas', () => {
    expect(classNotesBlock([])).toBe('');
    expect(classNotesBlock(null)).toBe('');
    const b = classNotesBlock(['Usamos pesos colombianos', 'usamos pesos colombianos', { text: 'Nota minima de 3,0 para aprobar' }]);
    expect(b).toContain('CONTEXTO DE ESTA CLASE');
    expect(b.match(/^- /gm)).toHaveLength(2);
    const muchas = classNotesBlock(Array.from({ length: 40 }, (_, i) => `Nota numero ${i} sobre la clase`));
    expect(muchas.match(/^- /gm)!.length).toBeLessThanOrEqual(MAX_NOTES);
  });
});

describe('errores comunes por concepto', () => {
  const calc = 'La respuesta marcada es incorrecta: el calculo esta mal';
  it('un patron necesita al menos 3 casos del MISMO error en el MISMO concepto', () => {
    const rows = [...Array(MIN_CONCEPT_ERRORS).fill(rej('elasticidad', calc)), rej('utilidad', calc), rej('utilidad', calc)];
    const h = conceptErrorHints(rows);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ concept: 'elasticidad', category: 'error_conceptual_o_calculo', count: 3 });
  });
  it('ignora aprobadas, pendientes, validador de forma, infraestructura y conceptos sin etiqueta', () => {
    const rows = [
      ...Array(5).fill(rej('a', calc, 'approved')),
      ...Array(5).fill(rej('b', calc, 'pending')),
      ...Array(5).fill(rej('c', '[validador de forma] falta el campo')),
      ...Array(5).fill(rej('d', 'Segundo juez no coincide: no se pudo obtener una segunda opinion')),
      ...Array(5).fill(rej(null, calc)),
    ];
    expect(conceptErrorHints(rows)).toEqual([]);
  });
  it('el bloque derivado habla de errores y trae los ejemplos solo como referencia', () => {
    const h = conceptErrorHints(Array(3).fill(rej('elasticidad', calc)));
    const b = derivedBlock(h, [{ concept_tag: 'elasticidad', q: 'Si el precio sube 10 % y la cantidad baja 20 %, ¿cuál es la elasticidad precio de la demanda?' }]);
    expect(b).toContain('ERRORES QUE SE REPITEN');
    expect(b).toContain('NO las copies');
    expect(derivedBlock([], [])).toBe('');
  });
});

describe('carga de memorias', () => {
  const dbConNotas = (notes: unknown[] | null, fail = false) => ({
    from: (t: string) => {
      const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: async () => (fail ? Promise.reject(new Error('x')) : { data: t === 'ai_class_notes' ? notes : [] }) };
      return q;
    },
  });
  it('sin cliente o ante un fallo devuelve vacio (la generacion sigue como siempre)', async () => {
    expect(await loadClassMemoryBlock(null, 'c')).toBe('');
    expect(await loadClassMemoryBlock(dbConNotas(null, true), 'c')).toBe('');
  });
  it('con notas activas arma el bloque; los derivados NO se leen si no se piden', async () => {
    const b = await loadClassMemoryBlock(dbConNotas([{ text: 'Usamos pesos colombianos' }]), 'c', { derived: false });
    expect(b).toContain('pesos colombianos');
  });
  it('CLASS_MEMORY esta apagado por defecto', () => {
    expect(classMemoryDerivedEnabled({})).toBe(false);
    expect(classMemoryDerivedEnabled({ CLASS_MEMORY: 'on' })).toBe(true);
  });
});

describe('cableado', () => {
  it('los dos puntos de generacion leen cuaderno + memorias con un solo cargador', () => {
    expect(read('src/app/api/generate-questions/route.ts')).toContain('loadStyleAndMemoryBlock(');
    expect(read('src/lib/questions/regeneratePool.ts')).toContain('loadStyleAndMemoryBlock(');
  });
  it('las notas solo se escriben desde acciones del profesor y la migracion limita por RLS al dueno de la clase', () => {
    const a = read('src/lib/actions/playbook.ts');
    expect(a).toContain("from('ai_class_notes').insert");
    const sql = read('supabase/migrations/102_ai_class_notes.sql');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('c.teacher_id = (SELECT auth.uid())');
    expect(sql).toContain('REVOKE ALL ON public.ai_class_notes FROM anon');
    expect(sql).not.toMatch(/DELETE FROM|UPDATE public/i);
  });
  it('la pantalla ofrece agregar y retirar notas', () => {
    const c = read('src/app/(teacher)/teacher/classrooms/[id]/playbook/PlaybookClient.tsx');
    expect(c).toContain('addClassNote');
    expect(c).toContain('retireClassNote');
  });
});
