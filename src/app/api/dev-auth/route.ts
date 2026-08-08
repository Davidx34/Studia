import { NextRequest, NextResponse } from 'next/server';
import { verifyDevCredentials, createDevSessionToken, DEV_SESSION_COOKIE } from '@/lib/devAuth';
import { getClientIp, checkRateLimit, recordFailedAttempt, clearAttempts } from '@/lib/devRateLimit';

// Login del panel de desarrollador. Verificacion 100% server-side contra
// DEV_PASSWORD (env var) — la contraseña nunca llega a una tabla ni se
// compara en el cliente. Con backoff exponencial tras N intentos fallidos
// para mitigar brute force (Protocolo 7.7.2 de la auditoría).
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Datos invalidos' }, { status: 400 });
  }

  if (!process.env.DEV_PASSWORD || !process.env.DEV_SESSION_SECRET) {
    return NextResponse.json({ error: 'Panel de desarrollador no configurado' }, { status: 500 });
  }

  // Rate limiting por IP
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Demasiados intentos fallidos. Intenta en ${Math.ceil(limit.retryAfterMs / 1000)}s.` },
      { status: 429, headers: { 'Retry-After': Math.ceil(limit.retryAfterMs / 1000).toString() } }
    );
  }

  if (!verifyDevCredentials(email, password)) {
    recordFailedAttempt(ip);
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 });
  }

  // Credenciales correctas: limpiar intentos fallidos
  clearAttempts(ip);

  const token = createDevSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEV_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEV_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
