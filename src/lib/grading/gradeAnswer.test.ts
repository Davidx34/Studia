import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { gradeAnswer } from './gradeAnswer';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const correct = (r: ReturnType<typeof gradeAnswer>) => (r.status === 'graded' ? r.correct : r.status);

describe('gradeAnswer: opcion multiple y verdadero/falso', () => {
  it('compara el indice elegido con la clave', () => {
    expect(correct(gradeAnswer({ type: 'multiple_choice', ok: 2 }, { selectedIndex: 2 }))).toBe(true);
    expect(correct(gradeAnswer({ type: 'multiple_choice', ok: 2 }, { selectedIndex: 0 }))).toBe(false);
  });

  it('el indice 0 es una respuesta valida (no se confunde con "vacio")', () => {
    expect(correct(gradeAnswer({ type: 'multiple_choice', ok: 0 }, { selectedIndex: 0 }))).toBe(true);
  });

  it('verdadero/falso compara booleanos, incluido false', () => {
    expect(correct(gradeAnswer({ type: 'true_false', ok: false }, { selected: false }))).toBe(true);
    expect(correct(gradeAnswer({ type: 'true_false', ok: true }, { selected: false }))).toBe(false);
  });

  it('una respuesta de otra forma es invalida, no "incorrecta"', () => {
    expect(correct(gradeAnswer({ type: 'multiple_choice', ok: 1 }, { selected: true }))).toBe('invalid');
    expect(correct(gradeAnswer({ type: 'true_false', ok: true }, { selectedIndex: 1 }))).toBe('invalid');
    expect(correct(gradeAnswer({ type: 'multiple_choice', ok: 1 }, null))).toBe('invalid');
    expect(correct(gradeAnswer({ type: 'multiple_choice' }, { selectedIndex: 1 }))).toBe('invalid');
  });
});

describe('gradeAnswer: completar y respuesta corta', () => {
  it('ignora mayusculas, tildes y espacios de mas', () => {
    expect(correct(gradeAnswer({ type: 'fill_blank', answers: ['fotosíntesis'] }, { text: '  La FOTOSINTESIS  ocurre' }))).toBe(true);
  });

  it('exige TODAS las palabras', () => {
    const key = { type: 'fill_blank', answers: ['clorofila', 'luz'] };
    expect(correct(gradeAnswer(key, { text: 'clorofila y luz' }))).toBe(true);
    expect(correct(gradeAnswer(key, { text: 'solo clorofila' }))).toBe(false);
  });

  it('sin claves no puntua (antes de esto, short_answer sumaba siempre)', () => {
    expect(correct(gradeAnswer({ type: 'short_answer', keywords: [] }, { text: 'lo que sea' }))).toBe(false);
    expect(correct(gradeAnswer({ type: 'short_answer' }, { text: 'lo que sea' }))).toBe(false);
    expect(correct(gradeAnswer({ type: 'fill_blank', answers: [] }, { text: 'x' }))).toBe(false);
  });

  it('respuesta corta por palabras clave', () => {
    const key = { type: 'short_answer', keywords: ['célula', 'núcleo'] };
    expect(correct(gradeAnswer(key, { text: 'El nucleo esta en la celula' }))).toBe(true);
    expect(correct(gradeAnswer(key, { text: 'la celula' }))).toBe(false);
  });

  it('el texto debe ser una cadena', () => {
    expect(correct(gradeAnswer({ type: 'fill_blank', answers: ['a'] }, { text: 5 }))).toBe('invalid');
    expect(correct(gradeAnswer({ type: 'short_answer', keywords: ['a'] }, {}))).toBe('invalid');
  });
});

describe('gradeAnswer: emparejar', () => {
  const key = { type: 'match', pairs: [{ term: 'a', def: '1' }, { term: 'b', def: '2' }, { term: 'c', def: '3' }] };

  it('correcto solo si cada termino quedo con su propia definicion', () => {
    expect(correct(gradeAnswer(key, { pairing: [0, 1, 2] }))).toBe(true);
    expect(correct(gradeAnswer(key, { pairing: [1, 0, 2] }))).toBe(false);
    expect(correct(gradeAnswer(key, { pairing: [0, 1, -1] }))).toBe(false);
  });

  it('forma invalida: largo distinto, no numeros o sin pares', () => {
    expect(correct(gradeAnswer(key, { pairing: [0, 1] }))).toBe('invalid');
    expect(correct(gradeAnswer(key, { pairing: [0, 1, '2'] }))).toBe('invalid');
    expect(correct(gradeAnswer(key, { pairing: 'x' }))).toBe('invalid');
    expect(correct(gradeAnswer({ type: 'match', pairs: [] }, { pairing: [] }))).toBe('invalid');
  });
});

describe('gradeAnswer: lo que aun no verifica', () => {
  it('los minijuegos quedan como "unsupported" (se tratan en la fase 4)', () => {
    for (const t of ['el_descifrador', 'impostor', 'linea_tiempo', 'categorias', 'minigame']) {
      expect(correct(gradeAnswer({ type: t }, { text: 'x' }))).toBe('unsupported');
    }
  });
});

describe('modo sombra: retirado', () => {
  it('la ruta y el cliente del modo sombra ya no existen (tras la migracion 086 el estudiante no lee el banco y el registro quedo sin efecto)', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/api/lesson/shadow/route.ts'))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), 'src/lib/grading/shadowClient.ts'))).toBe(false);
  });
  it('la pagina de la leccion ya no informa intentos al modo sombra', () => {
    const page = read('src/app/(student)/lesson/[id]/page.tsx');
    expect(page).not.toContain('reportShadow');
    expect(page).not.toContain('shadowClient');
    expect(page).not.toContain('/api/lesson/shadow');
  });
  it('la tabla de registro (migracion 065) se conserva como historia: solo admite INSERT propio y nadie la lee desde la app', () => {
    const sql = read('supabase/migrations/065_grading_shadow_log.sql');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON public.grading_shadow_log FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT INSERT ON public.grading_shadow_log TO authenticated');
    expect(sql).not.toMatch(/GRANT (SELECT|UPDATE|DELETE|ALL)/);
    expect(sql).toContain('WITH CHECK (student_id = (SELECT auth.uid()))');
  });
});
