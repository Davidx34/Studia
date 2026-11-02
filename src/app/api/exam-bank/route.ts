import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey, MISSING_SERVICE_KEY_MESSAGE } from '@/lib/supabase/admin';
import { reviewQuestion } from '@/lib/blueprint/examBank';
import { supabaseBankDb } from '@/lib/blueprint/examBankDb';

// Revision del banco de preguntas de examen: el profesor DUEÑO de la clase aprueba o rechaza una pregunta (cualquier otro recibe 404). Leer el banco NO pasa por aqui: lo hace el
// navegador con su sesion y la RLS de la migracion 088 (solo el profesor dueño ve las preguntas; un estudiante, JAMAS: tienen las claves). El navegador no escribe la tabla.
export const maxDuration = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_CHARS = 2_000;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

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
    if (body?.action !== 'review') return fail(400, 'accion invalida');
    const classroomId = typeof body?.classroomId === 'string' ? body.classroomId : '';
    if (!UUID_RE.test(classroomId)) return fail(400, 'classroomId invalido');

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail(401, 'No autenticado');

    // Propiedad con la sesion del profesor (RLS): una clase ajena no aparece.
    const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
    if (!classroom) return fail(404, 'Clase no encontrada');

    if (!hasServiceRoleKey()) return fail(503, MISSING_SERVICE_KEY_MESSAGE);
    const r = await reviewQuestion(supabaseBankDb(createAdminSupabase() as any), { classroomId, reviewerId: user.id }, body?.questionId, body?.decision);
    if (!r.ok) return fail(r.status, r.error);
    return NextResponse.json({ ok: true, status: r.status });
  } catch (e) {
    console.error('[exam-bank] error:', e instanceof Error ? e.message : 'desconocido');
    return fail(500, 'Error inesperado.');
  }
}
