// 04 — El salto Next.js -> Supabase Auth SIN cuentas: el middleware llama a Supabase Auth (getUser) en CADA peticion con cookie de sesion. Con una cookie de sesion FALSA (token invalido) la
// peticion hace ese mismo viaje a Supabase, recibe 401 y la app redirige a /login. Sirve para medir el costo y el limite de ese salto sin escribir nada ni usar cuentas reales.
// (No mide paginas de estudiante: para eso esta 02 con cuentas de prueba.)
//
//   k6 run -e BASE_URL=http://localhost:3000 -e SUPABASE_URL=https://REF.supabase.co -e PROFILE=load -e TARGET_VUS=20 loadtest/04-auth-hop.js
import http from 'k6/http';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';
import { BASE_URL, env, required, stagesFor } from './lib/config.js';
import { authCookieName, authCookies, cookieHeader } from './lib/cookie.js';

export const options = {
  scenarios: { saltoAuth: { ...stagesFor(env('PROFILE', 'smoke')), tags: { escenario: 'auth_hop' } } },
  thresholds: {
    // 307 -> /login es lo esperado: k6 sigue la redireccion y el destino debe responder 200.
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:dashboard_token_falso}': ['p(95)<1500'],
    checks: ['rate>0.99'],
  },
};

// JWT con forma valida pero firma falsa (no es una credencial: expira en 2001 y no lo firmo nadie).
const fakeJwt = `${encoding.b64encode('{"alg":"HS256","typ":"JWT"}', 'rawurl')}.${encoding.b64encode('{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated","exp":1000000000}', 'rawurl')}.ZmlybWFfZmFsc2E`;
const session = { access_token: fakeJwt, refresh_token: 'falso', token_type: 'bearer', expires_in: 3600, expires_at: 1000000000, user: { id: '00000000-0000-4000-8000-000000000000' } };

export default function () {
  const cookie = cookieHeader(authCookies(authCookieName(required('SUPABASE_URL')), session, (s) => encoding.b64encode(s, 'rawurl')));
  const res = http.get(`${BASE_URL()}/dashboard`, { headers: { Cookie: cookie }, tags: { name: 'dashboard_token_falso' } });
  check(res, { 'termina en /login (sin sesion valida)': (r) => r.status === 200 && String(r.url).includes('/login') });
  sleep(0.5 + Math.random());
}
