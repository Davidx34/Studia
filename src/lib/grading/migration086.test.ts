import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'supabase/migrations');
const FILE = '086_contraer_escrituras_de_estudiante.sql';
const sql = fs.readFileSync(path.join(dir, FILE), 'utf8').replace(/\r\n/g, '\n');
// Sin comentarios: las reglas se comprueban sobre el SQL que se ejecuta, no sobre lo que dicen los comentarios.
const code = sql.replace(/^--.*$/gm, '');
const earlier = fs
  .readdirSync(dir)
  .filter((f) => /^\d{3}_/.test(f) && f < FILE)
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
  .join('\n');

describe('migracion 086 (contraer): lo que cierra', () => {
  it('es la siguiente despues de la 085', () => {
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f)).sort();
    expect(files.indexOf(FILE)).toBe(files.indexOf('085_course_blueprints.sql') + 1);
  });
  it('student_progress: se quita la politica ALL del estudiante y queda solo una de LECTURA de su fila', () => {
    expect(code).toContain('DROP POLICY IF EXISTS "Students manejan su progreso" ON public.student_progress;');
    const p = code.match(/CREATE POLICY students_read_own_progress[\s\S]*?;/)![0];
    expect(p).toContain('FOR SELECT USING (student_id = (SELECT auth.uid()))');
    expect(code).toContain('REVOKE ALL ON TABLE public.student_progress FROM anon;');
    expect(code).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_progress FROM authenticated;');
  });
  it('question_attempts: se quita el INSERT propio y se revocan las escrituras', () => {
    expect(code).toContain('DROP POLICY IF EXISTS students_insert_own_question_attempts ON public.question_attempts;');
    expect(code).toContain('REVOKE ALL ON TABLE public.question_attempts FROM anon;');
    expect(code).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.question_attempts FROM authenticated;');
  });
  it('lesson_questions: se quitan las politicas de estudiante (leer E insertar)', () => {
    expect(code).toContain('DROP POLICY IF EXISTS students_read_lesson_questions ON public.lesson_questions;');
    expect(code).toContain('DROP POLICY IF EXISTS students_insert_lesson_questions ON public.lesson_questions;');
    expect(code).toContain('REVOKE ALL ON TABLE public.lesson_questions FROM anon;');
    expect(code).toContain('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lesson_questions FROM authenticated;');
  });
  it('los nombres de las politicas que se quitan EXISTEN en migraciones anteriores (no hay errores de tipeo)', () => {
    for (const name of ['Students manejan su progreso', 'students_insert_own_question_attempts', 'students_read_lesson_questions', 'students_insert_lesson_questions']) {
      expect(earlier, name).toContain(name);
    }
  });
});

describe('migracion 086: lo que NO debe romper', () => {
  it('no se quita el SELECT a authenticated en ninguna tabla (el estudiante lee lo suyo y el profesor lo de su clase)', () => {
    for (const r of code.match(/REVOKE [^;]+;/g) ?? []) {
      if (/FROM authenticated/.test(r)) expect(r, r).not.toMatch(/\bSELECT\b|\bALL\b/);
    }
  });
  it('lesson_questions conserva INSERT/UPDATE/DELETE para authenticated: el profesor escribe con su sesion', () => {
    const r = code.match(/REVOKE [^;]+ON TABLE public\.lesson_questions FROM authenticated;/)![0];
    expect(r).not.toMatch(/INSERT|UPDATE|DELETE/);
  });
  it('no toca ninguna politica del profesor', () => {
    for (const d of code.match(/DROP POLICY IF EXISTS [^;]+;/g) ?? []) expect(d, d).not.toMatch(/teachers?_|Teachers/i);
    expect(code).not.toContain('Teachers ven progreso de sus estudiantes');
  });
  it('solo quita politicas y privilegios: no crea objetos nuevos salvo la lectura de student_progress, ni usa SECURITY DEFINER', () => {
    expect(code).not.toMatch(/SECURITY DEFINER/i);
    expect(code).not.toMatch(/CREATE (TABLE|FUNCTION|TRIGGER|INDEX)/i);
    expect(code).not.toMatch(/ALTER TABLE|DROP TABLE|DROP COLUMN|TRUNCATE TABLE|DELETE FROM|UPDATE public\./i);
    const created = code.match(/CREATE POLICY [^\s]+/g) ?? [];
    expect(created).toEqual(['CREATE POLICY students_read_own_progress']);
    for (const g of code.match(/GRANT [^;]+;/g) ?? []) throw new Error('no deberia conceder nada: ' + g);
  });
  it('es re-ejecutable: todo DROP lleva IF EXISTS', () => {
    for (const d of code.match(/DROP POLICY [^;]+;/g) ?? []) expect(d).toContain('IF EXISTS');
  });
  it('el codigo que reemplaza esas escrituras ya existe (el servidor marca en progreso y maneja el banco)', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'supabase/migrations/084_finish_lesson.sql'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, '084_finish_lesson.sql'), 'utf8')).toMatch(/SECURITY DEFINER/); // finish_lesson escribe student_progress con los privilegios de su dueño
  });
});
