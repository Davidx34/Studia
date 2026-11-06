// Cuentas de PRUEBA (pruebas de carga y funcionales): interruptor, creacion en lote y registro «reales frente a de prueba». Codigo puro con las dependencias inyectadas (sin red): lo usa la
// ruta /api/dev/test-accounts (solo con la sesion del panel /dev) y lo prueba vitest.
//
// Reglas (decididas por el dueño):
//   - El interruptor nace APAGADO y se lee ANTES DE CADA cuenta: apagarlo detiene un lote en marcha.
//   - Solo se crean cuentas de ESTUDIANTE, con correo `carga<NN>@<dominio de prueba>` (dominio .test: reservado, nunca entrega correo real) y hasta el tope `max_accounts`.
//   - Las contraseñas se generan al azar, se devuelven UNA vez en la respuesta y NO se guardan en ninguna parte (el registro solo tiene id y correo).

export const TEST_DOMAIN_DEFAULT = 'studia-carga.test';
export const MAX_BATCH = 20;

export type Control = { enabled: boolean; max: number };
export type StopReason = 'detenido' | 'tope' | 'error';
export type Credential = { email: string; password: string };
export type CreateResult = { created: Credential[]; stoppedBy?: StopReason; message?: string };

// ¿Es una cuenta de prueba? Registrada como tal, o con correo del dominio reservado .test (las dos cuentas de profesor y ocho de estudiante que ya existian lo son).
export function isTestEmail(email: string | null | undefined, registered = false): boolean {
  return registered || /\.test$/i.test((email ?? '').trim());
}

export function testEmail(index: number, domain = TEST_DOMAIN_DEFAULT): string {
  return `carga${String(index).padStart(2, '0')}@${domain.toLowerCase()}`;
}

// Primer indice libre (1, 2, 3...) que no este ya usado.
export function nextFreeIndex(existingEmails: Iterable<string>, domain = TEST_DOMAIN_DEFAULT): number {
  const used = new Set(Array.from(existingEmails, (e) => e.toLowerCase()));
  let i = 1;
  while (used.has(testEmail(i, domain))) i++;
  return i;
}

export type Profile = { id: string; role: string | null; email: string | null };
export type Summary = {
  real: { students: number; teachers: number; others: number; total: number };
  test: { students: number; teachers: number; others: number; total: number };
  total: number;
};

export function summarize(profiles: readonly Profile[], registeredIds: ReadonlySet<string>): Summary {
  const blank = () => ({ students: 0, teachers: 0, others: 0, total: 0 });
  const out: Summary = { real: blank(), test: blank(), total: profiles.length };
  for (const p of profiles) {
    const bucket = isTestEmail(p.email, registeredIds.has(p.id)) ? out.test : out.real;
    if (p.role === 'student') bucket.students++;
    else if (p.role === 'teacher') bucket.teachers++;
    else bucket.others++;
    bucket.total++;
  }
  return out;
}

export interface CreateDeps {
  readControl(): Promise<Control>;
  existingTestEmails(): Promise<string[]>;
  addInvite(email: string): Promise<{ error?: string }>;
  createUser(args: { email: string; password: string; username: string; fullName: string }): Promise<{ id?: string; error?: string; code?: string }>;
  register(userId: string, email: string): Promise<{ error?: string }>;
  randomPassword(): string;
  domain?: string;
}

// Crea hasta `count` cuentas. Vuelve a leer el interruptor ANTES DE CADA UNA: si se apaga a mitad del lote, se detiene y devuelve lo ya creado.
export async function createTestAccounts(count: number, deps: CreateDeps): Promise<CreateResult> {
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n < 1 || n > MAX_BATCH) return { created: [], stoppedBy: 'error', message: `La cantidad debe ser de 1 a ${MAX_BATCH}.` };
  const domain = deps.domain ?? TEST_DOMAIN_DEFAULT;
  const created: Credential[] = [];
  const existing = await deps.existingTestEmails();
  const taken = new Set(existing.map((e) => e.toLowerCase()));
  for (let i = 0; i < n; i++) {
    const control = await deps.readControl();
    if (!control.enabled) return { created, stoppedBy: 'detenido', message: 'El interruptor está apagado: no se crean más cuentas.' };
    if (taken.size >= control.max) return { created, stoppedBy: 'tope', message: `Se alcanzó el tope de ${control.max} cuentas de prueba.` };
    const idx = nextFreeIndex(taken, domain);
    const email = testEmail(idx, domain);
    const password = deps.randomPassword();
    const invite = await deps.addInvite(email);
    if (invite.error) return { created, stoppedBy: 'error', message: `No se pudo invitar ${email}: ${invite.error}` };
    const user = await deps.createUser({ email, password, username: `carga_estudiante_${String(idx).padStart(2, '0')}`, fullName: `Carga Estudiante ${String(idx).padStart(2, '0')}` });
    if (user.error || !user.id) {
      // Un correo ya usado (por una cuenta que no estaba en el registro) se salta; cualquier otro fallo detiene el lote para no insistir.
      if (user.code === 'email_exists') {
        taken.add(email);
        i--;
        continue;
      }
      return { created, stoppedBy: 'error', message: `Supabase rechazó ${email}: ${user.error ?? 'sin detalle'}${user.code === 'email_address_invalid' ? ' (el dominio de prueba no es aceptado por Auth)' : ''}` };
    }
    const reg = await deps.register(user.id, email);
    if (reg.error) return { created: [...created, { email, password }], stoppedBy: 'error', message: `La cuenta ${email} se creó pero no se pudo registrar como de prueba: ${reg.error}` };
    taken.add(email);
    created.push({ email, password });
  }
  return { created };
}
