import { NextRequest, NextResponse } from 'next/server';
import { verifyDevCredentials, createDevSessionToken, DEV_SESSION_COOKIE } from '@/lib/devAuth';

// Login del panel de desarrollador. Verificacion 100% server-side contra
// DEV_PASSWORD (env var) — la contraseña nunca llega a una tabla ni se
// compara en el cliente.
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Datos invalidos' }, { status: 400 });
  }

  if (!process.env.DEV_PASSWORD || !process.env.DEV_SESSION_SECRET) {
    return NextResponse.json({ error: 'Panel de desarrollador no configurado' }, { status: 500 });
  }

  if (!verifyDevCredentials(email, password)) {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 });
  }

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
