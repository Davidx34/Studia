import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/067_claim_pending_enrollments.sql')
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

// El comportamiento real (cuenta atascada desde septiembre -> inscrita; anon denegado; profesor 0; segunda llamada 0) se
// verifico en produccion en una transaccion revertida. Esto evita que alguien quite las defensas.
describe('migracion 067: claim_pending_enrollments', () => {
  it('solo actua sobre quien llama y solo para estudiantes autenticados', () => {
    expect(sql).toContain("auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'");
    expect(sql).toContain("role = 'student'");
    // el correo sale de la cuenta de Auth, no de un parametro
    expect(sql).toContain('FROM auth.users WHERE id = auth.uid()');
    expect(sql).not.toMatch(/claim_pending_enrollments\([^)]+\)/);
    expect(sql).not.toMatch(/current_user/);
  });

  it('no queda ejecutable por anon', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.claim_pending_enrollments() FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_pending_enrollments() TO authenticated;');
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*\banon\b/);
  });

  it('es idempotente: no duplica inscripciones y limpia lo consumido', () => {
    expect(sql).toContain('ON CONFLICT (classroom_id, student_id) DO NOTHING');
    expect(sql).toContain('DELETE FROM public.pending_enrollments');
  });

  it('el inicio del estudiante la llama antes de listar las clases y tolera que falle', () => {
    const page = read('src/app/(student)/dashboard/page.tsx');
    const call = page.indexOf(".rpc('claim_pending_enrollments')");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(page.indexOf("from('profiles')"));
    // dentro de un try/catch: un fallo no impide abrir el inicio
    const before = page.slice(0, call);
    expect(before.lastIndexOf('try {')).toBeGreaterThan(before.lastIndexOf('redirect('));
    expect(page).toContain("console.warn('[claim_pending_enrollments]'");
  });
});
