import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { containsExpected } from './normalize';
import { gradeAnswer } from '@/lib/grading/gradeAnswer';

describe('containsExpected: contiene, pero no a mitad de palabra', () => {
  it('el caso medido: «inelastica» NO vale por «elastica»; los antonimos con prefijo tampoco', () => {
    expect(containsExpected('inelástica', 'elástica')).toBe(false);
    expect(containsExpected('la demanda es inelástica', 'elástica')).toBe(false);
    expect(containsExpected('desventaja', 'ventaja')).toBe(false);
    expect(containsExpected('anticiclico', 'ciclico')).toBe(false);
    expect(containsExpected('microeconomía', 'economía')).toBe(false);
  });
  it('lo que SI sigue valiendo: igual, dentro de una frase, plural, genero y conjugacion', () => {
    expect(containsExpected('elástica', 'elástica')).toBe(true);
    expect(containsExpected('La demanda es ELÁSTICA.', 'elastica')).toBe(true);
    expect(containsExpected('los precios', 'precio')).toBe(true);
    expect(containsExpected('elásticas', 'elástica')).toBe(true);
    expect(containsExpected('maximizan su utilidad', 'maximiza')).toBe(true);
  });
  it('expresiones de varias palabras, con signos y numeros', () => {
    expect(containsExpected('el costo de oportunidad', 'costo de oportunidad')).toBe(true);
    expect(containsExpected('el costo de oportunidad', 'costo de oportunidades')).toBe(false);
    expect(containsExpected('vale -3 aqui', '-3')).toBe(true);
    expect(containsExpected('vale 3 aqui', '-3')).toBe(false); // el signo no se pierde
    expect(containsExpected('x^2 + 1', 'x^2')).toBe(true);
    expect(containsExpected('el 15 %', '15')).toBe(true);
    expect(containsExpected('el 150', '15')).toBe(true); // sufijo numerico: sigue siendo «contiene» (limite conocido)
    expect(containsExpected('el a15', '15')).toBe(false);
    expect(containsExpected('el 215', '15')).toBe(false); // a mitad de un numero
  });
  it('encuentra una aparicion valida aunque haya otra a mitad de palabra antes', () => {
    expect(containsExpected('inelástica pero elástica', 'elástica')).toBe(true);
    expect(containsExpected('inelástica e inelástica', 'elástica')).toBe(false);
  });
  it('una respuesta esperada vacia (o solo espacios) nunca se cumple', () => {
    expect(containsExpected('cualquier cosa', '')).toBe(false);
    expect(containsExpected('cualquier cosa', '   ')).toBe(false);
    expect(containsExpected('', 'algo')).toBe(false);
  });
});

describe('el calificador del servidor usa esa regla', () => {
  it('completar: «inelastica» ya no acierta; las palabras clave tampoco se cumplen a mitad de palabra', () => {
    const fill = { type: 'fill_blank', answers: ['elástica'] };
    expect(gradeAnswer(fill, { text: 'elástica' })).toMatchObject({ status: 'graded', correct: true });
    expect(gradeAnswer(fill, { text: 'inelástica' })).toMatchObject({ status: 'graded', correct: false });
    const short = { type: 'short_answer', keywords: ['sustitutos', 'precio'] };
    expect(gradeAnswer(short, { text: 'Hay sustitutos y el precio cambia' })).toMatchObject({ correct: true, detail: { matched: 2, total: 2 } });
    expect(gradeAnswer(short, { text: 'insustitutos y el precio' })).toMatchObject({ correct: false, detail: { matched: 1, total: 2 } });
    expect(gradeAnswer(short, { text: 'los precios' })).toMatchObject({ correct: false, detail: { matched: 1, total: 2 } });
  });
  it('plural y genero siguen valiendo (no se endurece lo que ya funcionaba)', () => {
    expect(gradeAnswer({ type: 'fill_blank', answers: ['precio'] }, { text: 'precios' })).toMatchObject({ correct: true });
  });
});

describe('el navegador usa la MISMA regla (no divergen)', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/(student)/lesson/[id]/page.tsx'), 'utf8');
  it('completar y respuesta corta del cliente llaman a containsExpected y ya no usan includes a pelo', () => {
    expect(page).toContain("import { containsExpected } from '@/lib/lesson/normalize';");
    expect(page).toContain('(q.keywords || []).filter((k) => containsExpected(shortAnswerText, k)).length');
    expect(page).toContain('(q.answers || []).filter((a) => containsExpected(fillBlankText, a)).length');
    expect(page).not.toMatch(/norm\.includes\(normalizeAnswer/);
  });
});
