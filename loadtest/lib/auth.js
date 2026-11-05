// Inicio de sesion de las cuentas de PRUEBA y cookie para la app. La sesion se pide a Supabase Auth (POST /auth/v1/token) con la llave publica y se guarda por VU; se renueva sola
// antes de que venza (los tokens duran 1 hora: importante en el perfil soak).
import http from 'k6/http';
import encoding from 'k6/encoding';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { authCookieName, authCookies, cookieHeader } from './cookie.js';
import { required } from './config.js';

export const loginFailures = new Counter('login_failures');

const encodeB64Url = (s) => encoding.b64encode(s, 'rawurl');

// Cuentas de prueba: arreglo [{ "email": "...", "password": "..." }, ...] (users.json; NO se versiona). Cada VU usa la suya (vu % n).
export function pickUser(users, vuId) {
  if (!users || users.length === 0) throw new Error('USERS_FILE no tiene cuentas');
  return users[(vuId - 1) % users.length];
}

let cache = null; // por VU

export function sessionFor(user) {
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.email === user.email && cache.session.expires_at - 120 > now) return cache;
  const supabaseUrl = required('SUPABASE_URL');
  const res = http.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, JSON.stringify({ email: user.email, password: user.password }), {
    headers: { apikey: required('SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
    tags: { name: 'auth_login' },
  });
  const ok = check(res, { 'login 200': (r) => r.status === 200 });
  if (!ok) {
    loginFailures.add(1);
    return null;
  }
  const session = res.json();
  if (!session.expires_at) session.expires_at = now + (session.expires_in || 3600);
  cache = { email: user.email, session, header: cookieHeader(authCookies(authCookieName(supabaseUrl), session, encodeB64Url)) };
  return cache;
}
