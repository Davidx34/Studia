import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Guardas de las migraciones 059 y 060. El comportamiento real (cada politica con el mismo nombre, comando y roles;
// la misma cantidad de filas visibles para estudiante, profesor, no inscrito y anonimo en las 34 tablas con RLS,
// antes y despues) se verifico en produccion en una transaccion revertida, porque solo la base real aplica RLS.
const strip = (rel: string) =>
  fs
    .readFileSync(path.join(process.cwd(), rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

const m059 = strip('supabase/migrations/059_rls_initplan_and_fk_indexes.sql');
const m060 = strip('supabase/migrations/060_function_hygiene.sql');

describe('migracion 059: rendimiento de RLS e indices', () => {
  it('reescribe politicas con ALTER POLICY (nunca DROP/CREATE: no hay ventana sin proteccion)', () => {
    expect(m059).toContain('ALTER POLICY');
    expect(m059).not.toMatch(/DROP POLICY|CREATE POLICY/);
  });

  it('envuelve auth.uid()/role()/jwt()/current_setting() sin volver a envolver lo ya envuelto', () => {
    expect(m059).toContain('(?<!SELECT )');
    expect(m059).toContain("'(SELECT \\1)'");
  });

  it('solo toca el esquema public', () => {
    expect(m059).toContain("WHERE schemaname = 'public'");
  });

  it('crea indices de forma idempotente y sobre las 19 claves foraneas que faltaban', () => {
    const idx = m059.match(/CREATE INDEX IF NOT EXISTS idx_\w+ ON public\.\w+ \(\w+\);/g) ?? [];
    expect(idx.length).toBe(19);
    expect(m059).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/);
  });

  it('no cambia la semantica de las politicas: no agrega ni quita condiciones', () => {
    expect(m059).not.toMatch(/\bOR true\b|\bUSING \(true\)/i);
  });
});

describe('migracion 060: higiene de funciones', () => {
  it('fija search_path = public en las 6 funciones con search_path mutable', () => {
    expect(m060.match(/SET search_path = public;/g)!.length).toBe(6);
  });

  it('las funciones de trigger dejan de ser invocables por RPC, y supabase_auth_admin conserva EXECUTE', () => {
    for (const fn of ['handle_new_user()', 'auto_enroll_pending()']) {
      expect(m060).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
      expect(m060).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO supabase_auth_admin;`);
    }
  });

  it('no toca check_pending_registration (el registro por invitacion la necesita sin sesion)', () => {
    expect(m060).not.toContain('check_pending_registration');
  });
});
