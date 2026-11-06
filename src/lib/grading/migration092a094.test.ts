import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'supabase/migrations');
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
const code = (f: string) => read(f).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migraciones 092 a 094 (avisos de Supabase)', () => {
  it('son consecutivas despues de la 091', () => {
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_/.test(f)).sort();
    const i = files.indexOf('091_test_accounts.sql');
    expect(files.slice(i + 1, i + 4)).toEqual(['092_rls_initplan.sql', '093_fusionar_politicas_permisivas.sql', '094_indices_claves_foraneas.sql']);
  });

  it('092 solo reescribe politicas: ALTER POLICY, idempotente y sin tocar datos ni permisos', () => {
    const c = code('092_rls_initplan.sql');
    expect(c).toContain("format('ALTER POLICY %I ON %I.%I'");
    expect(c).toContain('!~');
    expect(c).toContain("'(SELECT auth.\\1())'");
    expect(c).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|UPDATE|GRANT|REVOKE)\b/);
  });

  it('093 fusiona con OR por comando, omite tablas con roles/restrictivas y es idempotente', () => {
    const c = code('093_fusionar_politicas_permisivas.sql');
    expect(c).toContain("' OR '");
    expect(c).toContain("permissive <> 'PERMISSIVE' OR roles::text <> '{public}'");
    expect(c).toContain('HAVING count(*) > 1');
    // una politica FOR ALL aporta a los cuatro comandos
    expect(c).toContain("p.cmd = c OR p.cmd = 'ALL'");
    // las expresiones efectivas respetan la regla de Postgres (USING sin WITH CHECK y al reves)
    expect(c).toContain('coalesce(p.qual, p.with_check)');
    expect(c).toContain('coalesce(p.with_check, p.qual)');
    // borra las originales ANTES de crear las nuevas, en la misma transaccion (el DO es atomico)
    expect(c.indexOf('FOREACH s IN ARRAY v_drops')).toBeLessThan(c.indexOf('FOREACH s IN ARRAY v_creates'));
    expect(c).not.toMatch(/\b(TRUNCATE|GRANT|REVOKE)\b|DELETE FROM|DROP TABLE/);
  });

  it('094 solo crea indices (IF NOT EXISTS) sobre las 8 claves foraneas avisadas', () => {
    const c = code('094_indices_claves_foraneas.sql');
    const idx = c.match(/CREATE INDEX IF NOT EXISTS \w+ ON public\.\w+ \([^)]+\);/g) ?? [];
    expect(idx).toHaveLength(8);
    expect(c.replace(/CREATE INDEX IF NOT EXISTS \w+ ON public\.\w+ \([^)]+\);/g, '').trim()).toBe('');
  });

  it('el documento deja claro por que NO se revocan las 13 funciones SECURITY DEFINER', () => {
    const d = fs.readFileSync(path.join(process.cwd(), 'docs/SEGURIDAD_SUPABASE_2026-11-06.md'), 'utf8');
    expect(d).toContain('NO se revocan');
    expect(d).toContain('rompería la app');
  });
});
