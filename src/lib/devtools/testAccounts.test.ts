import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestAccounts, isTestEmail, nextFreeIndex, summarize, testEmail, type Control, type CreateDeps } from './testAccounts';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

describe('isTestEmail / testEmail / nextFreeIndex', () => {
  it('.test (dominio reservado) o registrada = de prueba; lo demas, real', () => {
    expect(isTestEmail('profe@studia.test')).toBe(true);
    expect(isTestEmail(' CARGA01@Studia-Carga.TEST ')).toBe(true);
    expect(isTestEmail('ana@gmail.com')).toBe(false);
    expect(isTestEmail('ana@gmail.com', true)).toBe(true);
    expect(isTestEmail(null)).toBe(false);
    expect(isTestEmail('x@testing.com')).toBe(false);
  });
  it('correos carga01.., y primer indice libre aunque haya huecos', () => {
    expect(testEmail(3)).toBe('carga03@studia-carga.test');
    expect(testEmail(12, 'Otro.Test')).toBe('carga12@otro.test');
    expect(nextFreeIndex([])).toBe(1);
    expect(nextFreeIndex([testEmail(1), testEmail(2), testEmail(4)])).toBe(3);
    expect(nextFreeIndex(['CARGA01@STUDIA-CARGA.TEST'])).toBe(2);
  });
});

describe('summarize: registro de cuentas reales y de prueba', () => {
  it('cuenta por rol y por tipo (registradas, .test o reales)', () => {
    const s = summarize(
      [
        { id: '1', role: 'student', email: 'a@gmail.com' },
        { id: '2', role: 'teacher', email: 'b@colegio.edu' },
        { id: '3', role: 'student', email: 'x@studia.test' },
        { id: '4', role: 'student', email: 'y@gmail.com' }, // registrada
        { id: '5', role: 'teacher', email: 'p@studia.test' },
        { id: '6', role: null, email: null },
      ],
      new Set(['4']),
    );
    expect(s.real).toEqual({ students: 1, teachers: 1, others: 1, total: 3 });
    expect(s.test).toEqual({ students: 2, teachers: 1, others: 0, total: 3 });
    expect(s.total).toBe(6);
  });
});

// Dependencias falsas con registro de lo que pasa.
function fake(over: Partial<CreateDeps> & { controls?: Control[] } = {}) {
  const log = { invites: [] as string[], users: [] as string[], registered: [] as string[], reads: 0 };
  let n = 0;
  const controls = over.controls ?? [{ enabled: true, max: 20 }];
  const deps: CreateDeps = {
    readControl: async () => controls[Math.min(log.reads++, controls.length - 1)],
    existingTestEmails: async () => [],
    addInvite: async (e) => (log.invites.push(e), {}),
    createUser: async ({ email }) => (log.users.push(email), { id: `id${++n}` }),
    register: async (_id, e) => (log.registered.push(e), {}),
    randomPassword: () => `pw${n}`,
    ...over,
  };
  delete (deps as any).controls;
  return { deps, log };
}

describe('createTestAccounts', () => {
  it('encendido: crea N cuentas con invitacion, usuario y registro, y devuelve las credenciales', async () => {
    const { deps, log } = fake();
    const r = await createTestAccounts(3, deps);
    expect(r.stoppedBy).toBeUndefined();
    expect(r.created.map((c) => c.email)).toEqual([testEmail(1), testEmail(2), testEmail(3)]);
    expect(log.invites).toEqual(log.users);
    expect(log.registered).toEqual(log.users);
    expect(r.created.every((c) => c.password.length > 0)).toBe(true);
  });
  it('APAGADO desde el inicio: no crea nada (ni invita)', async () => {
    const { deps, log } = fake({ controls: [{ enabled: false, max: 20 }] });
    const r = await createTestAccounts(5, deps);
    expect(r).toMatchObject({ created: [], stoppedBy: 'detenido' });
    expect(log.invites.length + log.users.length).toBe(0);
  });
  it('se apaga A MITAD del lote: se detiene y devuelve solo lo ya creado (el interruptor se lee antes de cada cuenta)', async () => {
    const { deps, log } = fake({ controls: [{ enabled: true, max: 20 }, { enabled: true, max: 20 }, { enabled: false, max: 20 }] });
    const r = await createTestAccounts(10, deps);
    expect(r.stoppedBy).toBe('detenido');
    expect(r.created.length).toBe(2);
    expect(log.reads).toBe(3);
  });
  it('respeta el tope contando las ya existentes', async () => {
    const { deps } = fake({ controls: [{ enabled: true, max: 3 }], existingTestEmails: async () => [testEmail(1), testEmail(2)] });
    const r = await createTestAccounts(5, deps);
    expect(r.created.map((c) => c.email)).toEqual([testEmail(3)]);
    expect(r.stoppedBy).toBe('tope');
  });
  it('un correo ya usado fuera del registro se salta; otro rechazo detiene el lote con el motivo', async () => {
    let calls = 0;
    const a = fake({ createUser: async ({ email }) => (++calls === 1 ? { error: 'ya existe', code: 'email_exists' } : { id: email }) });
    const r1 = await createTestAccounts(2, a.deps);
    expect(r1.created.map((c) => c.email)).toEqual([testEmail(2), testEmail(3)]);
    const b = fake({ createUser: async () => ({ error: 'Email address is invalid', code: 'email_address_invalid' }) });
    const r2 = await createTestAccounts(3, b.deps);
    expect(r2).toMatchObject({ created: [], stoppedBy: 'error' });
    expect(r2.message).toContain('no es aceptado por Auth');
    expect(b.log.registered).toEqual([]);
  });
  it('fallo al invitar o al registrar: se detiene (y lo creado sin registrar se devuelve para no perder la cuenta)', async () => {
    const inv = await createTestAccounts(2, fake({ addInvite: async () => ({ error: 'x' }) }).deps);
    expect(inv).toMatchObject({ created: [], stoppedBy: 'error' });
    const reg = await createTestAccounts(2, fake({ register: async () => ({ error: 'y' }) }).deps);
    expect(reg.stoppedBy).toBe('error');
    expect(reg.created.length).toBe(1);
  });
  it('cantidad fuera de 1..20 o no numerica: rechaza sin tocar nada', async () => {
    const { deps, log } = fake();
    for (const n of [0, -1, 21, NaN, Infinity]) expect((await createTestAccounts(n as number, deps)).stoppedBy, String(n)).toBe('error');
    expect(log.reads + log.invites.length).toBe(0);
  });
});

describe('ruta, migracion y panel', () => {
  it('la ruta exige la sesion del panel en GET y POST y nunca devuelve contraseñas en el registro', () => {
    const r = read('src/app/api/dev/test-accounts/route.ts');
    expect(r.match(/if \(!\(await requireDevSession\(\)\)\) return NextResponse\.json\(\{ error: 'No autorizado' \}, \{ status: 401 \}\);/g)?.length).toBe(2);
    expect(r).toContain("'Cache-Control': 'no-store'");
    const get = r.slice(r.indexOf('export async function GET'), r.indexOf('export async function POST'));
    expect(get).not.toMatch(/password/i);
    expect(r).toContain("p_role: 'student'"); // solo estudiantes
    expect(r).toContain('enabled: data?.enabled === true'); // sin fila o con error: APAGADO
  });
  it('migracion 091: interruptor APAGADO por defecto, RLS sin politicas, sin permisos para anon/authenticated y sin contraseñas', () => {
    const code = read('supabase/migrations/091_test_accounts.sql').replace(/^--.*$/gm, '');
    expect(code).toContain('enabled      boolean NOT NULL DEFAULT false');
    expect(code).toContain('CHECK (id = 1)');
    expect(code.match(/ENABLE ROW LEVEL SECURITY/g)?.length).toBe(2);
    expect(code).not.toContain('CREATE POLICY');
    expect(code.match(/REVOKE ALL ON TABLE public\.test_account(s|_control) FROM anon, authenticated;/g)?.length).toBe(2);
    expect(code).not.toMatch(/password/i);
    expect(code).toContain('ON DELETE CASCADE');
  });
  it('el panel tiene la pestaña, el boton DETENER y la descarga de users.json', () => {
    expect(read('src/app/dev/dashboard/DevDashboardClient.tsx')).toContain("{tab === 'test' && <TestAccountsTab />}");
    const t = read('src/app/dev/dashboard/TestAccountsTab.tsx');
    expect(t).toContain('DETENER');
    expect(t).toContain("a.download = 'users.json'");
    expect(t).toContain('disabled={busy || !control.enabled}');
  });
});
