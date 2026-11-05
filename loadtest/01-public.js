// 01 — Linea base SIN sesion: paginas publicas y assets de la PWA. Mide el borde de Vercel + el middleware (que consulta Supabase Auth) sin tocar datos. Es la prueba mas segura:
// no escribe nada y no usa IA ni cuentas.
//
//   k6 run -e BASE_URL=http://localhost:3000 -e PROFILE=load loadtest/01-public.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, env, stagesFor } from './lib/config.js';

export const options = {
  scenarios: { publico: { ...stagesFor(env('PROFILE', 'smoke')), tags: { escenario: 'publico' } } },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:login}': ['p(95)<1200'],
    'http_req_duration{name:manifest}': ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const base = BASE_URL();
  const login = http.get(`${base}/login`, { tags: { name: 'login' } });
  check(login, { 'login 200': (r) => r.status === 200 });
  const manifest = http.get(`${base}/manifest.json`, { tags: { name: 'manifest' } });
  check(manifest, { 'manifest 200 json': (r) => r.status === 200 && String(r.headers['Content-Type']).includes('json') });
  const offline = http.get(`${base}/offline`, { tags: { name: 'offline' } });
  check(offline, { 'offline 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
}
