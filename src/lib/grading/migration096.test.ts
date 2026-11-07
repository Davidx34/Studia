import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'supabase/migrations');
const code = fs.readFileSync(path.join(dir, '096_ai_feedback_events.sql'), 'utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migracion 096 (registro de senales de la IA)', () => {
  it('sigue a la 095', () => {
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f)).sort();
    expect(files[files.indexOf('095_indice_exam_sessions_blueprint.sql') + 1]).toBe('096_ai_feedback_events.sql');
  });

  it('es solo de servidor: RLS sin politicas y sin permisos para anon/authenticated', () => {
    expect(code).toContain('ALTER TABLE public.ai_feedback_events ENABLE ROW LEVEL SECURITY;');
    expect(code).toContain('ALTER TABLE public.question_stats ENABLE ROW LEVEL SECURITY;');
    expect(code).toContain('REVOKE ALL ON public.ai_feedback_events FROM anon, authenticated;');
    expect(code).toContain('REVOKE ALL ON public.question_stats FROM anon, authenticated;');
    expect(code).not.toMatch(/CREATE POLICY/);
    expect(code).toContain('GRANT EXECUTE ON FUNCTION public.recompute_question_stats() TO service_role;');
  });

  it('un trigger registra cada cambio de review_status/reviewed_by y las funciones fijan search_path', () => {
    expect(code).toContain('AFTER UPDATE OF review_status, reviewed_by ON public.lesson_questions');
    expect(code).toContain('NEW.review_status IS DISTINCT FROM OLD.review_status');
    expect((code.match(/SET search_path = public, pg_temp/g) ?? []).length).toBe(2);
  });

  it('el respaldo es idempotente y es aditivo (no borra ni altera datos existentes)', () => {
    expect(code).toContain('NOT EXISTS (SELECT 1 FROM public.ai_feedback_events)');
    expect(code).not.toMatch(/\b(TRUNCATE|DROP TABLE)\b|UPDATE public\.lesson_questions|DELETE FROM public\.(lesson_questions|question_attempts)/);
  });

  it('question_stats excluye la clase de prueba de carga', () => {
    expect(code).toContain("c.name NOT LIKE '[CARGA]%'");
  });
});
