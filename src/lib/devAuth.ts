// Sesion del panel de desarrollador (/dev/*), separada por completo del auth
// de Supabase. Fase 11 · Mejora Estructural 3/4 · Stud.ia
//
// Diseño de seguridad (aprobado explicitamente por el usuario en vez de lo
// que pedia el doc original, que guardaba la contraseña real en texto plano
// en una migracion de git y la comparaba en el cliente):
// - La contraseña vive SOLO en la variable de entorno DEV_PASSWORD (nunca
//   en git, nunca expuesta al cliente).
// - La verificacion pasa por una API route server-side (/api/dev-auth), no
//   por una query de Supabase desde el navegador.
// - La sesion es una cookie httpOnly firmada con HMAC-SHA256 usando
//   DEV_SESSION_SECRET (otra env var), asi que no hace falta guardar
//   sesiones en una tabla ni exponer nada verificable desde el cliente.

import { cookies } from 'next/headers';
import crypto from 'crypto';

export const DEV_EMAIL = 'catral.josedavid@gmail.com';
export const DEV_SESSION_COOKIE = 'studia_dev_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

function getSecret(): string {
  const secret = process.env.DEV_SESSION_SECRET;
  if (!secret) throw new Error('DEV_SESSION_SECRET no configurado');
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function verifyDevCredentials(email: string, password: string): boolean {
  const devPassword = process.env.DEV_PASSWORD;
  if (!devPassword) return false;
  if (email.trim().toLowerCase() !== DEV_EMAIL) return false;

  const a = Buffer.from(password);
  const b = Buffer.from(devPassword);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// El token no necesita llevar el email: solo existe un usuario dev posible
// (DEV_EMAIL), y evitar caracteres como "@" en el valor de la cookie evita
// problemas de encode/decode inconsistente entre el Set-Cookie del servidor
// y la lectura posterior via cookies().
export function createDevSessionToken(): string {
  const payload = `${Date.now() + SESSION_TTL_MS}`;
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function isValidDevSessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expStr, signature] = parts;

  let expected: string;
  try {
    expected = sign(expStr);
  } catch {
    return false;
  }

  const sigA = Buffer.from(signature);
  const sigB = Buffer.from(expected);
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) return false;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;

  return true;
}

export async function requireDevSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidDevSessionToken(cookieStore.get(DEV_SESSION_COOKIE)?.value);
}
