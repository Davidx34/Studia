import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireDevSession } from '@/lib/devAuth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createTestAccounts, summarize, type CreateDeps, type Control } from '@/lib/devtools/testAccounts';

// Cuentas de prueba desde el panel /dev (sesion propia del panel; ver src/lib/devAuth.ts). GET = registro (reales frente a de prueba, interruptor, correos de prueba: NUNCA contraseñas).
// POST { action: 'toggle', enabled } enciende/apaga el interruptor; POST { action: 'create', count } crea cuentas SI el interruptor esta encendido y devuelve las credenciales UNA sola vez.
export const maxDuration = 60;

const db = () => createAdminSupabase() as any;
const domain = () => (process.env.TEST_ACCOUNT_DOMAIN || 'studia-carga.test').toLowerCase();

async function readControl(admin: any): Promise<Control> {
  const { data } = await admin.from('test_account_control').select('enabled, max_accounts').eq('id', 1).maybeSingle();
  // Sin fila o con error: APAGADO (lo seguro).
  return { enabled: data?.enabled === true, max: Number(data?.max_accounts ?? 20) };
}

export async function GET() {
  if (!(await requireDevSession())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const admin = db();
    const [{ data: profiles, error: pe }, { data: reg, error: re }, control] = await Promise.all([
      admin.from('profiles').select('id, role, email'),
      admin.from('test_accounts').select('user_id, email, created_at').order('created_at', { ascending: true }),
      readControl(admin),
    ]);
    if (pe || re) return NextResponse.json({ error: (pe ?? re).message }, { status: 500 });
    const ids = new Set<string>((reg ?? []).map((r: any) => r.user_id));
    return NextResponse.json({ summary: summarize(profiles ?? [], ids), control, domain: domain(), registered: (reg ?? []).map((r: any) => ({ email: r.email, createdAt: r.created_at })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireDevSession())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => null);
  try {
    const admin = db();
    if (body?.action === 'toggle') {
      if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled debe ser true o false' }, { status: 400 });
      const { error } = await admin.from('test_account_control').update({ enabled: body.enabled, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ control: await readControl(admin) });
    }
    if (body?.action === 'create') {
      const deps: CreateDeps = {
        domain: domain(),
        readControl: () => readControl(admin),
        existingTestEmails: async () => {
          const { data } = await admin.from('test_accounts').select('email');
          return (data ?? []).map((r: any) => r.email as string);
        },
        addInvite: async (email) => {
          const { error } = await admin.rpc('dev_add_pending_registration', { p_email: email, p_role: 'student' });
          return error ? { error: error.message } : {};
        },
        createUser: async ({ email, password, username, fullName }) => {
          const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, full_name: fullName } });
          return error ? { error: error.message, code: (error as any).code } : { id: data.user?.id };
        },
        register: async (userId, email) => {
          const { error } = await admin.from('test_accounts').insert({ user_id: userId, email });
          return error ? { error: error.message } : {};
        },
        randomPassword: () => crypto.randomBytes(9).toString('base64url') + 'Aa1',
      };
      const result = await createTestAccounts(Number(body.count), deps);
      // Las credenciales viajan SOLO en esta respuesta (no se guardan en ningun sitio).
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ error: 'Accion desconocida' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
