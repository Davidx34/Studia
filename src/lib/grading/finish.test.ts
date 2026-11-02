import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { finishLessonOnServer } from './finishClient';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

// ───────────────────────── el ayudante del navegador ─────────────────────────
describe('finishLessonOnServer', () => {
  const reply = (status: number) => vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch;

  it('200 -> "ok"', async () => {
    expect(await finishLessonOnServer('a', 30, reply(200))).toBe('ok');
  });
  it('manda el intento y el tiempo, nada de puntaje ni de estado', async () => {
    const f = reply(200);
    await finishLessonOnServer('att-1', 42, f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/lesson/finish');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ attemptId: 'att-1', elapsedSeconds: 42 });
  });
  it('el servidor lo rechaza (quedan preguntas, no es suyo, nada que calificar) -> "rejected": NO se escribe el progreso a mano', async () => {
    for (const status of [400, 401, 404, 409, 413, 422]) expect(await finishLessonOnServer('a', 1, reply(status)), String(status)).toBe('rejected');
  });
  it('no disponible (calificacion apagada 503, migracion sin aplicar 501, error del servidor, sin red) -> "unavailable": se sigue como antes', async () => {
    for (const status of [501, 503, 500, 502]) expect(await finishLessonOnServer('a', 1, reply(status)), String(status)).toBe('unavailable');
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await finishLessonOnServer('a', 1, down)).toBe('unavailable');
  });
});

// ───────────────────────── la ruta, con la base simulada ─────────────────────────
const h = vi.hoisted(() => ({
  user: { id: 'stu-1' } as { id: string } | null,
  rpc: null as null | ((name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>),
  calls: [] as { name: string; args: Record<string, unknown> }[],
  hasKey: true,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  hasServiceRoleKey: () => h.hasKey,
  MISSING_SERVICE_KEY_MESSAGE: 'sin llave',
  createAdminSupabase: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push({ name, args });
      return h.rpc ? h.rpc(name, args) : { data: null, error: null };
    },
  }),
}));

const ATT = '11111111-1111-4111-8111-111111111111';
const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/lesson/finish/route');
  return POST(new Request('http://localhost/api/lesson/finish', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }) as never);
};
const rpcReturns = (data: unknown) => {
  h.rpc = async () => ({ data, error: null });
};

describe('POST /api/lesson/finish (comportamiento)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ejemplo.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x'.repeat(40));
    vi.stubEnv('SERVER_GRADING', 'on');
    h.user = { id: 'stu-1' };
    h.hasKey = true;
    h.rpc = null;
    h.calls = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('cierra: llama a finish_lesson con el estudiante de la SESION y devuelve lo que calculo el servidor', async () => {
    rpcReturns({ ok: true, already: false, score: 67, correct: 2, total: 3, seconds: 120 });
    const res = await post({ attemptId: ATT, elapsedSeconds: 120, studentId: 'otro', score: 100, status: 'completed' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ score: 67, correct: 2, total: 3, seconds: 120, already: false });
    expect(h.calls).toEqual([{ name: 'finish_lesson', args: { p_attempt_id: ATT, p_student_id: 'stu-1', p_client_seconds: 120 } }]);
  });

  it('SEGURIDAD: ni el puntaje ni el estado ni el estudiante que manda el navegador llegan a la base', async () => {
    rpcReturns({ ok: true, score: 0, correct: 0, total: 1, seconds: 0 });
    await post({ attemptId: ATT, elapsedSeconds: 5, score: 100, status: 'completed', studentId: 'victima', p_student_id: 'victima' });
    expect(Object.keys(h.calls[0].args).sort()).toEqual(['p_attempt_id', 'p_client_seconds', 'p_student_id']);
    expect(h.calls[0].args.p_student_id).toBe('stu-1');
  });

  it('el tiempo se acota y se redondea; lo invalido pasa a 0', async () => {
    rpcReturns({ ok: true, score: 100, correct: 1, total: 1, seconds: 0 });
    const secs = async (v: unknown) => {
      h.calls = [];
      await post({ attemptId: ATT, elapsedSeconds: v });
      return h.calls[0].args.p_client_seconds;
    };
    expect(await secs(99999)).toBe(7200);
    expect(await secs(-50)).toBe(0);
    expect(await secs(12.6)).toBe(13);
    expect(await secs('abc')).toBe(0);
    expect(await secs(undefined)).toBe(0);
    expect(await secs(Infinity)).toBe(0);
  });

  it('ya cerrado: devuelve el mismo resultado con already=true', async () => {
    rpcReturns({ ok: true, already: true, score: 67, correct: 2, total: 3, seconds: 120 });
    expect(await (await post({ attemptId: ATT })).json()).toMatchObject({ score: 67, already: true });
  });

  it('errores de la funcion -> codigos claros', async () => {
    rpcReturns({ ok: false, error: 'not_found' });
    expect((await post({ attemptId: ATT })).status).toBe(404);
    rpcReturns({ ok: false, error: 'unanswered', answered: 1, total: 3 });
    const unanswered = await post({ attemptId: ATT });
    expect(unanswered.status).toBe(409);
    expect(await unanswered.json()).toMatchObject({ answered: 1, total: 3 });
    rpcReturns({ ok: false, error: 'nothing_to_grade' });
    expect((await post({ attemptId: ATT })).status).toBe(422);
    rpcReturns({ ok: false, error: 'invalid' });
    expect((await post({ attemptId: ATT })).status).toBe(400);
    rpcReturns(null);
    expect((await post({ attemptId: ATT })).status).toBe(400);
  });

  it('la migracion sin aplicar (funcion inexistente) -> 501, para que el navegador siga como antes', async () => {
    h.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.finish_lesson' } });
    expect((await post({ attemptId: ATT })).status).toBe(501);
    h.rpc = async () => ({ data: null, error: { code: '42883', message: 'function public.finish_lesson(uuid, uuid, integer) does not exist' } });
    expect((await post({ attemptId: ATT })).status).toBe(501);
  });

  it('otro error de la base -> 500 generico, sin filtrar el detalle', async () => {
    h.rpc = async () => ({ data: null, error: { code: 'XX000', message: 'detalle interno secreto' } });
    const res = await post({ attemptId: ATT });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secreto');
  });

  it('sin sesion 401; sin calificacion activa 503; cuerpo roto o id invalido 400; y en esos casos NO se llama a la base', async () => {
    h.user = null;
    expect((await post({ attemptId: ATT })).status).toBe(401);
    h.user = { id: 'stu-1' };
    vi.stubEnv('SERVER_GRADING', 'off');
    expect((await post({ attemptId: ATT })).status).toBe(503);
    vi.stubEnv('SERVER_GRADING', 'on');
    expect((await post('{no es json')).status).toBe(400);
    expect((await post({ attemptId: 'no-es-uuid' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
});

// ───────────────────────── la migracion y la lección (estáticos) ─────────────────────────
describe('migracion 084', () => {
  const sql = read('supabase/migrations/084_finish_lesson.sql');
  it('la funcion es SECURITY DEFINER con search_path fijo y SOLO la ejecuta service_role', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.finish_lesson\(/);
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.finish_lesson\(uuid, uuid, integer\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.finish_lesson\(uuid, uuid, integer\) TO service_role;/);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*(authenticated|anon|PUBLIC)/);
  });
  it('comprueba que el intento es del estudiante, lo bloquea, es idempotente y exige todas las preguntas cerradas', () => {
    expect(sql).toMatch(/WHERE id = p_attempt_id AND student_id = p_student_id FOR UPDATE/);
    expect(sql).toMatch(/IF a\.status = 'finished' THEN/);
    expect(sql).toMatch(/IF v_answered < v_total THEN/);
    expect(sql).toContain("'unanswered'");
  });
  it('el puntaje sale de las respuestas verificadas y el tiempo se acota (2 horas y reloj del servidor)', () => {
    expect(sql).toMatch(/count\(\*\) FILTER \(WHERE final AND correct\)/);
    expect(sql).toMatch(/FROM public\.lesson_attempt_answers/);
    expect(sql).toMatch(/least\(coalesce\(p_client_seconds, 0\), 7200, extract\(epoch FROM \(now\(\) - a\.started_at\)\)::integer\)/);
  });
  it('el mejor puntaje es el maximo y el intento suma 1', () => {
    expect(sql).toMatch(/best_score\s+= greatest\(coalesce\(public\.student_progress\.best_score, 0\), EXCLUDED\.score\)/);
    expect(sql).toMatch(/attempts\s+= coalesce\(public\.student_progress\.attempts, 0\) \+ 1/);
  });
  it('NO cierra todavia la politica ALL de student_progress (rompe las lecciones que el servidor aun no califica)', () => {
    expect(sql).not.toMatch(/student_progress[^;]*(DROP POLICY|REVOKE)/i);
    expect(sql).not.toMatch(/DROP POLICY[^;]*Students manejan su progreso/);
  });
  it('generated_questions deja de ser legible por cualquier autenticado: solo el profesor de la clase', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Autenticados leen preguntas" ON public\.generated_questions;/);
    expect(sql).toMatch(/c\.teacher_id = auth\.uid\(\)/);
    expect(sql).not.toMatch(/auth\.role\(\) = 'authenticated'/);
  });
});

describe('la leccion del navegador', () => {
  const page = read('src/app/(student)/lesson/[id]/page.tsx');
  const save = page.slice(page.indexOf('const saveProgress ='), page.indexOf('const retrySave ='));
  it('la pagina cierra la leccion con closeLesson, el cliente real del servidor y los logros DESPUES de guardar (la logica esta probada en saveOutcome.test.ts)', () => {
    expect(save).toContain('closeLesson(attemptIdRef.current, {');
    expect(save).toContain('finish: finishLessonOnServer,');
    expect(save).toContain('seconds: elapsedSeconds,');
    expect(save).toContain('onSaved: evaluateAchievements,');
    expect(page).toContain("import { closeLesson, noticeFor, type SaveOutcome } from '@/lib/grading/saveOutcome';");
  });
  it('YA NO hay respaldo de escritura directa: el navegador no escribe student_progress (migracion 086)', () => {
    expect(save).not.toContain("from('student_progress')");
    expect(save).not.toContain('upsert');
    expect(page).not.toContain("from('student_progress')");
  });
  it('un fallo de guardado se AVISA al estudiante, con reintento solo cuando sirve', () => {
    expect(page).toContain("const [saveOutcome, setSaveOutcome] = useState<SaveOutcome>('saved');");
    // el resultado se informa al cerrar el modulo Y al reintentar (dos llamadas, no basta una)
    expect(page.match(/setSaveOutcome\(await saveProgress\(\)\);/g)).toHaveLength(2);
    expect(page).toMatch(/setSaveOutcome\(await saveProgress\(\)\);\s*useTonitoStore\.getState\(\)\.onModuleComplete\(scorePercent\);/);
    expect(page).toContain('const notice = noticeFor(saveOutcome);');
    // el aviso se dibuja cuando hay aviso (no se anula con una condicion fija)
    expect(page).toContain('const saveNotice = notice && (');
    expect(page).toContain('{notice.canRetry ? (');
    expect(page).toContain('No pudimos guardar tu resultado');
    expect(page).toContain('Reintentar guardado');
    // el aviso esta en las DOS pantallas finales (repaso completado y leccion completada)
    expect(page.match(/\{saveNotice\}/g)).toHaveLength(2);
    // el reintento relee el resultado
    expect(page).toMatch(/const retrySave = async \(\) => \{\s*setSaving\(true\);\s*setSaveOutcome\(await saveProgress\(\)\);\s*setSaving\(false\);\s*\};/);
  });
  it('el navegador no manda su puntaje al servidor', () => {
    expect(save).not.toMatch(/finishLessonOnServer\([^)]*(scorePercent|finalScore|score)/);
  });
});
