import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Guarda de la migracion 063. El comportamiento real (alta sin invitacion rechazada y sin usuario creado, alta con
// invitacion aceptada aunque venga en mayusculas, invitacion ya usada rechazada, anon sin acceso a la consulta) se
// verifico en produccion en una transaccion revertida, porque solo la base real ejecuta el disparador de auth.users.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/063_enforce_invite_only_signup.sql')
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

describe('migracion 063: registro solo por invitacion, en la base de datos', () => {
  it('el disparador de alta rechaza correos sin invitacion sin usar (insensible a mayusculas y espacios)', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.handle_new_user()');
    expect(sql).toMatch(/IF NOT EXISTS \([\s\S]*pending_registrations[\s\S]*lower\(pr\.email\) = lower\(trim\(NEW\.email\)\)[\s\S]*pr\.used_at IS NULL[\s\S]*RAISE EXCEPTION/);
  });

  it('la comprobacion va ANTES de crear el perfil', () => {
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('INSERT INTO public.profiles'));
  });

  it('mantiene search_path fijo y SECURITY DEFINER, y supabase_auth_admin conserva EXECUTE', () => {
    expect(sql).toContain("SET search_path TO 'public', 'auth'");
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;');
  });

  it('check_pending_registration solo para service_role', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.check_pending_registration(text) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.check_pending_registration(text) TO service_role;');
  });
});

describe('pagina de registro', () => {
  const page = read('src/app/(auth)/signup/page.tsx');

  it('ya no consulta la invitacion desde el navegador', () => {
    expect(page).not.toContain("rpc(\n      'check_pending_registration'");
    expect(page).not.toMatch(/rpc\(\s*'check_pending_registration'/);
  });

  it('un rechazo de la base se explica sin revelar que correos estan invitados', () => {
    expect(page).toContain("message.includes('database error')");
    expect(page).toContain('Si tu email no ha sido invitado, pide que te inviten primero.');
  });

  it('sigue aplicando el rol de la invitacion con apply_pending_registration', () => {
    expect(page).toContain('apply_pending_registration');
  });
});
