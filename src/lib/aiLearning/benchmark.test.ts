import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { AGE_BANDS, CONSENT_TEXT, LEVELS, SUBJECTS, parseProfile, typeLabel } from './benchmark';

const mig = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/099_global_benchmarks.sql'), 'utf8');
const code = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

const checkList = (col: string): string[] => {
  const m = code.match(new RegExp(`${col}\\s+text CHECK \\(${col} IN \\(([^)]*)\\)\\)`));
  return (m?.[1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1));
};

describe('taxonomia cerrada', () => {
  it('coincide EXACTAMENTE con los CHECK de la migracion 099', () => {
    expect(checkList('subject').sort()).toEqual(Object.keys(SUBJECTS).sort());
    expect(checkList('level').sort()).toEqual(Object.keys(LEVELS).sort());
    expect(checkList('age_band').sort()).toEqual(Object.keys(AGE_BANDS).sort());
  });
  it('parseProfile rechaza texto libre, vacios y claves heredadas del prototipo', () => {
    expect(parseProfile({ subject: 'Mates', level: 'primaria', ageBand: '6-8' })).toBeNull();
    expect(parseProfile({ subject: 'economia', level: 'universitario' })).toBeNull();
    expect(parseProfile({ subject: 'toString', level: 'primaria', ageBand: '6-8' })).toBeNull();
    expect(parseProfile({ subject: 'economia', level: 'universitario', ageBand: '18+' })).toEqual({ subject: 'economia', level: 'universitario', ageBand: '18+' });
  });
  it('typeLabel devuelve un nombre legible aun para tipos desconocidos', () => {
    expect(typeLabel('multiple_choice')).toBe('Opción múltiple');
    expect(typeLabel('el_descifrador')).toBe('el descifrador');
  });
});

describe('migracion 099: garantias de anonimato', () => {
  it('opt-in apagado por defecto, y exige estrato, fecha y version de consentimiento', () => {
    expect(code).toContain('share_opt_in    boolean NOT NULL DEFAULT false');
    expect(code).toContain('CHECK (NOT share_opt_in OR (subject IS NOT NULL AND level IS NOT NULL AND age_band IS NOT NULL AND consent_version IS NOT NULL AND opted_in_at IS NOT NULL))');
  });
  it('el piso de anonimato esta en la funcion Y en la tabla (no se puede publicar por debajo)', () => {
    expect(code).toContain('IF p_min_classes < 3 OR p_min_teachers < 2 OR p_min_attempts < 20 THEN');
    expect(code).toContain('n_classes >= 3');
    expect(code).toContain('n_teachers >= 2');
    expect(code).toContain('attempts >= 20');
  });
  it('solo cuenta clases que aportan, excluye [CARGA] y no guarda identificadores ni contenido', () => {
    expect(code).toContain('p.share_opt_in');
    expect(code).toContain("c.name NOT LIKE '[CARGA]%'");
    const table = code.slice(code.indexOf('CREATE TABLE IF NOT EXISTS public.global_benchmarks'), code.indexOf(');', code.indexOf('CREATE TABLE IF NOT EXISTS public.global_benchmarks')));
    expect(table).not.toMatch(/classroom_id|teacher_id|student|question_id|text\b.*q\b/);
  });
  it('global_benchmarks es solo de servidor y la funcion solo para service_role', () => {
    expect(code).toContain('REVOKE ALL ON public.global_benchmarks FROM anon, authenticated;');
    expect(code).toContain('GRANT EXECUTE ON FUNCTION public.recompute_global_benchmarks(integer, integer, integer) TO service_role;');
    expect((code.match(/CREATE POLICY/g) ?? []).length).toBe(1);
  });
});

describe('app', () => {
  it('el texto de consentimiento promete lo que hace: agregados, sin textos ni datos de estudiantes, revocable', () => {
    expect(CONSENT_TEXT).toContain('AGREGADAS');
    expect(CONSENT_TEXT).toContain('Nunca se comparten');
    expect(CONSENT_TEXT).toContain('revocar');
  });
  it('la pagina solo da la referencia a quien aporta y filtra por SU estrato', () => {
    const page = read('src/app/(teacher)/teacher/classrooms/[id]/global/page.tsx');
    expect(page).toContain('profile?.share_opt_in');
    expect(page).toContain(".eq('subject', profile.subject)");
    expect(page).toContain(".eq('level', profile.level)");
    expect(page).toContain(".eq('age_band', profile.age_band)");
  });
  it('la accion comprueba la propiedad de la clase antes de escribir y recalcula al cambiar', () => {
    const a = read('src/lib/actions/benchmark.ts');
    expect(a.indexOf("eq('teacher_id', user.id)")).toBeLessThan(a.indexOf("upsert(row"));
    expect(a).toContain("rpc('recompute_global_benchmarks')");
  });
});
