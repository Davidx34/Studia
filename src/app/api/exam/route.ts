import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey, MISSING_SERVICE_KEY_MESSAGE } from '@/lib/supabase/admin';
import { beginExam, submitExam } from '@/lib/blueprint/examRun';
import { supabaseRunDb } from '@/lib/blueprint/examRunDb';
import { QUOTA_POLICIES, consumeQuota, quotaDeniedBody } from '@/lib/security/rateLimit';

// Examenes del plan por cortes, para el ESTUDIANTE (docs/EVALUACIONES.md, «Sesion de examen»). Acciones:
//   - start:  empezar (o retomar) la evaluacion de un corte o la final. Devuelve las preguntas SIN claves, explicaciones ni fuentes.
//   - submit: entregar las respuestas. El servidor califica contra lo que SE SIRVIO, escribe el intento y devuelve la retroalimentacion (cuales acerto y fallo, con la explicacion, el corte,
//             el modulo y el material con su cita). Entregar dos veces devuelve el mismo resultado, no otro intento.
// El estudiante sale de la SESION (nunca del cuerpo); la matricula y el plan publicado se comprueban en el flujo. El navegador no toca las tablas de preguntas ni de sesiones.
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_CHARS = 100_000;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return fail(413, 'Peticion demasiado grande.');
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(400, 'JSON invalido');
    }
    const action = body?.action;
    if (action !== 'start' && action !== 'submit') return fail(400, 'accion invalida');

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail(401, 'No autenticado');

    if (!hasServiceRoleKey()) return fail(503, MISSING_SERVICE_KEY_MESSAGE);

    // Lo barato (forma de los ids) ANTES del cupo: una peticion invalida no gasta cupo.
    if (action === 'start' && (typeof body?.classroomId !== 'string' || !UUID_RE.test(body.classroomId))) return fail(400, 'classroomId invalido');
    if (action === 'submit' && (typeof body?.sessionId !== 'string' || !UUID_RE.test(body.sessionId))) return fail(400, 'sessionId invalido');

    const admin: any = createAdminSupabase();
    const quota = await consumeQuota((fn, args) => admin.rpc(fn, args), user.id, QUOTA_POLICIES.examSession);
    if (!quota.allowed) return NextResponse.json(quotaDeniedBody(quota.retryAfterSeconds, 'abrir o entregar evaluaciones'), { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds), 'Cache-Control': 'no-store' } });

    const db = supabaseRunDb(admin);
    const ctx = { studentId: user.id };
    const r = action === 'start' ? await beginExam(db, ctx, { classroomId: body.classroomId, kind: body.kind, periodId: body.periodId }) : await submitExam(db, ctx, { sessionId: body.sessionId, answers: body.answers });
    if (!r.ok) return fail(r.status, r.error);
    const { ok: _ok, ...rest } = r;
    return NextResponse.json({ ok: true, ...rest }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[exam] error:', e instanceof Error ? e.message : 'desconocido');
    return fail(500, 'Error inesperado.');
  }
}
