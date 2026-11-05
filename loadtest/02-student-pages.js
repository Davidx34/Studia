// 02 — Estudiantes navegando (SOLO LECTURA): dashboard, mis clases, mapa y la pagina de una clase. Cada una es una pagina renderizada en el servidor que consulta Supabase, asi que mide
// funciones de Vercel + conexiones/consultas de la base. Requiere cuentas de PRUEBA (users.json). No escribe nada.
//
//   k6 run -e BASE_URL=https://TU-PREVIEW.vercel.app -e SUPABASE_URL=https://REF.supabase.co -e SUPABASE_ANON_KEY=... \
//          -e CLASS_IDS=uuid1,uuid2 -e PROFILE=load loadtest/02-student-pages.js
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { BASE_URL, env, stagesFor } from './lib/config.js';
import { pickUser, sessionFor } from './lib/auth.js';

const users = new SharedArray('users', () => JSON.parse(open(env('USERS_FILE', './users.json'))));
const classIds = env('CLASS_IDS', '').split(',').map((s) => s.trim()).filter(Boolean);

export const options = {
  scenarios: { estudiantes: { ...stagesFor(env('PROFILE', 'smoke')), tags: { escenario: 'paginas' } } },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:dashboard}': ['p(95)<2500'],
    'http_req_duration{name:my_classes}': ['p(95)<2500'],
    'http_req_duration{name:map}': ['p(95)<2500'],
    'http_req_duration{name:class_page}': ['p(95)<2500'],
    login_failures: ['count==0'],
    checks: ['rate>0.99'],
  },
};

function visit(base, path, name, cookie) {
  const res = http.get(`${base}${path}`, { headers: { Cookie: cookie }, tags: { name } });
  // Sin sesion valida la app redirige a /login: eso cuenta como FALLO (la cookie no sirvio), no como exito.
  check(res, { [`${name} 200 y con sesion`]: (r) => r.status === 200 && !String(r.url).includes('/login') });
  return res;
}

export default function () {
  const s = sessionFor(pickUser(users, exec.vu.idInTest));
  if (!s) return sleep(5);
  const base = BASE_URL();
  visit(base, '/dashboard', 'dashboard', s.header);
  sleep(2 + Math.random() * 3);
  visit(base, '/my-classes', 'my_classes', s.header);
  sleep(2 + Math.random() * 3);
  visit(base, '/map', 'map', s.header);
  if (classIds.length > 0) {
    sleep(2 + Math.random() * 3);
    visit(base, `/my-classes/${classIds[Math.floor(Math.random() * classIds.length)]}`, 'class_page', s.header);
  }
  sleep(3 + Math.random() * 5);
}
