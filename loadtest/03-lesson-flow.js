// 03 — Flujo de leccion completo (ESCRIBE en la base): pide la leccion (/api/generate-questions), responde cada pregunta (/api/lesson/answer) y cierra (/api/lesson/finish).
// Es el camino mas caliente y el que mas escribe (lesson_attempts, lesson_attempt_answers, student_progress), por eso:
//   * usa SOLO cuentas de prueba y modulos de una clase desechable: deja intentos y progreso reales en esas cuentas;
//   * exige que el banco de preguntas del modulo YA este lleno (cached = true). Si el servidor tuviera que GENERAR con IA, se cuenta `unexpected_generation` y la prueba SE ABORTA:
//     una prueba de carga no debe gastar la cuota de los proveedores de IA;
//   * las respuestas son al azar: el puntaje no importa, importa que el servidor aguante la escritura.
//
//   k6 run -e BASE_URL=https://TU-PREVIEW.vercel.app -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... -e MODULE_IDS=uuid1,uuid2 -e PROFILE=aula loadtest/03-lesson-flow.js
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import { BASE_URL, env, required, stagesFor } from './lib/config.js';
import { loginAll, pickUser, sessionFromSetup } from './lib/auth.js';

const users = new SharedArray('users', () => JSON.parse(open(env('USERS_FILE', './users.json'))));
const moduleIds = required('MODULE_IDS').split(',').map((s) => s.trim()).filter(Boolean);
const THINK = Number(env('THINK_SECONDS', '4')); // pausa media entre preguntas (un estudiante real lee y piensa); 0 = martillar

const unexpectedGeneration = new Counter('unexpected_generation');
const lessonLocked = new Counter('lesson_locked');
const lessonsFinished = new Counter('lessons_finished');
const questionsSkipped = new Counter('questions_skipped_unsupported_type');
const lessonStart = new Trend('lesson_start_ms', true);
const lessonTotal = new Trend('lesson_total_ms', true);

export const options = {
  scenarios: { lecciones: { ...stagesFor(env('PROFILE', 'smoke')), tags: { escenario: 'leccion' } } },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{name:lesson_start}': ['p(95)<3000'],
    'http_req_duration{name:lesson_answer}': ['p(95)<1000', 'p(99)<2500'],
    'http_req_duration{name:lesson_finish}': ['p(95)<2000'],
    // Si el servidor empieza a GENERAR con IA la prueba se aborta (cuesta dinero y no es lo que se mide).
    unexpected_generation: [{ threshold: 'count==0', abortOnFail: true }],
    login_failures: ['count==0'],
    checks: ['rate>0.98'],
  },
};

// Respuesta valida segun el tipo (ver gradeAnswer). Los juegos y emparejar/linea del tiempo necesitan la forma exacta de cada pregunta: se omiten (se cuentan).
function answerFor(q, attempt) {
  switch (q.type) {
    case 'multiple_choice':
      return { selectedIndex: (Math.floor(Math.random() * 4) + attempt) % 4 };
    case 'true_false':
      return { selected: Math.random() < 0.5 };
    case 'fill_blank':
    case 'short_answer':
      return { text: 'respuesta de prueba de carga' };
    default:
      return null;
  }
}

export function setup() {
  return loginAll(Array.from(users)); // un inicio de sesion por cuenta, una sola vez (ver lib/auth.js)
}

export default function (sessions) {
  const s = sessionFromSetup(sessions, pickUser(users, exec.vu.idInTest), exec.vu.idInTest);
  if (!s) return sleep(5);
  const base = BASE_URL();
  const headers = { Cookie: s.header, 'Content-Type': 'application/json' };
  const moduleId = moduleIds[Math.floor(Math.random() * moduleIds.length)];
  const t0 = Date.now();

  const start = http.post(`${base}/api/generate-questions`, JSON.stringify({ moduleId, moduleTitle: 'Prueba de carga' }), { headers, tags: { name: 'lesson_start' } });
  lessonStart.add(Date.now() - t0);
  if (start.status === 403) {
    lessonLocked.add(1); // la cuenta no domina el modulo anterior (regla del 100 %): usa un modulo sin prerrequisitos o una cuenta que ya los domine
    return sleep(5);
  }
  if (!check(start, { 'start 200': (r) => r.status === 200 })) return sleep(5);
  const body = start.json();
  if (body.cached !== true) unexpectedGeneration.add(1);
  const attemptId = body.attemptId;
  if (!check(body, { 'start trae preguntas': (b) => Array.isArray(b.questions) && b.questions.length > 0, 'start trae attemptId (SERVER_GRADING activo)': (b) => typeof b.attemptId === 'string' })) return sleep(5);

  for (const q of body.questions) {
    if (!answerFor(q, 0) || !q.id) {
      questionsSkipped.add(1);
      continue;
    }
    // Una respuesta mala NO cierra la pregunta (quedan intentos): como el estudiante real, se vuelve a intentar hasta que el servidor la da por cerrada (`final`), maximo 5 veces.
    for (let attempt = 0; attempt < 5; attempt++) {
      sleep(THINK * (0.5 + Math.random()));
      const r = http.post(`${base}/api/lesson/answer`, JSON.stringify({ attemptId, questionId: q.id, answer: answerFor(q, attempt) }), { headers, tags: { name: 'lesson_answer' } });
      check(r, { 'answer 200': (x) => x.status === 200 });
      if (r.status !== 200 || r.json('final') === true) break;
    }
  }

  const fin = http.post(`${base}/api/lesson/finish`, JSON.stringify({ attemptId, elapsedSeconds: Math.round((Date.now() - t0) / 1000) }), { headers, tags: { name: 'lesson_finish' } });
  if (check(fin, { 'finish 200': (x) => x.status === 200 })) lessonsFinished.add(1);
  lessonTotal.add(Date.now() - t0);
  sleep(3 + Math.random() * 5);
}
