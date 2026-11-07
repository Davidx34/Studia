import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const code = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/098_course_cycles.sql'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const actions = fs.readFileSync(path.join(process.cwd(), 'src/lib/actions/cycles.ts'), 'utf8');

describe('migracion 098 (ciclos y retrospectivas)', () => {
  it('RLS solo del profesor dueno en ambas tablas y sin acceso anonimo', () => {
    expect(code).toContain('ALTER TABLE public.course_cycles ENABLE ROW LEVEL SECURITY;');
    expect(code).toContain('ALTER TABLE public.cycle_retrospectives ENABLE ROW LEVEL SECURITY;');
    expect((code.match(/CREATE POLICY/g) ?? []).length).toBe(2);
    expect((code.match(/c\.teacher_id = \(SELECT auth\.uid\(\)\)/g) ?? []).length).toBe(4);
    expect(code).toContain('REVOKE ALL ON public.course_cycles FROM anon;');
    expect(code).toContain('REVOKE ALL ON public.cycle_retrospectives FROM anon;');
  });
  it('es aditiva: no toca tablas existentes', () => {
    expect(code).not.toMatch(/\bDROP\b|(?<!ON )\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/);
    expect(code).not.toMatch(/ALTER TABLE public\.(?!course_cycles|cycle_retrospectives)/);
  });
});

describe('acciones de ciclos', () => {
  it('comprueban que la clase es del profesor ANTES de usar la llave de servicio', () => {
    expect(actions.indexOf('if (!own) return')).toBeGreaterThan(-1);
    expect(actions.indexOf('if (!own) return')).toBeLessThan(actions.indexOf('createAdminSupabase() as any'));
  });
  it('no borran ni modifican respuestas de estudiantes', () => {
    expect(actions).not.toMatch(/from\('(question_attempts|lesson_attempts|lesson_attempt_answers|student_progress)'\)\s*\.(delete|update|insert)/);
  });
});
