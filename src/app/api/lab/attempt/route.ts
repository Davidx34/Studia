import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey, MISSING_SERVICE_KEY_MESSAGE } from '@/lib/supabase/admin';
import { rowToItem, type LabRow } from '@/lib/lab/labRows';
import { parseAttemptState } from '@/lib/lab/protocol';
import { validateSubmission } from '@/lib/lab/submission';
import { guardJsonb } from '@/lib/db/jsonbGuard';

// El estudiante ENTREGA el informe de un laboratorio publicado de su clase. Nada que venga del navegador se acepta tal cual: se vuelve a leer el laboratorio (con la sesion del
// estudiante, asi que la base solo le muestra los publicados de sus clases), se valida el informe en el servidor (incluida la coherencia numerica de los ensayos) y recien entonces
// se guarda con la llave de servicio. La tabla no admite INSERT directo desde el navegador (migracion 082).
export const maxDuration = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_CHARS = 150_000;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return fail(413, 'El informe es demasiado grande.');
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* cuerpo no valido */
    }
    const labId = typeof body?.labId === 'string' ? body.labId : '';
    if (!UUID_RE.test(labId)) return fail(400, 'Petición inválida.');

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail(401, 'No autenticado');
    if (!hasServiceRoleKey()) return fail(503, MISSING_SERVICE_KEY_MESSAGE);

    // Con la sesion del estudiante: la politica de la tabla labs solo le deja ver los PUBLICADOS de las clases donde esta inscrito. Cualquier otro caso es "no encontrado".
    const db: any = supabase;
    const { data: row } = await db.from('labs').select('*').eq('id', labId).maybeSingle();
    if (!row || row.status !== 'published') return fail(404, 'Laboratorio no encontrado');
    const { data: enrollment } = await supabase.from('class_enrollments').select('student_id').eq('classroom_id', row.classroom_id).eq('student_id', user.id).maybeSingle();
    if (!enrollment) return fail(404, 'Laboratorio no encontrado');

    const lab = rowToItem(row as LabRow).lab;
    if (!lab) return fail(422, 'Este laboratorio ya no se puede abrir.');

    const state = parseAttemptState(body?.state);
    if (!state) return fail(400, 'El informe no tiene la forma esperada.');

    const checked = validateSubmission(lab, state);
    if (!checked.ok) return fail(422, 'Tu informe tiene problemas: ' + checked.errors.join(' '), { errors: checked.errors });

    // Documentos jsonb limpios y dentro del tope de sus columnas (un informe enorme se rechaza aqui, con un mensaje claro, y no con un error de la base).
    const trials = guardJsonb(checked.clean.trials, 'labTrials');
    const answers = guardJsonb(checked.clean.answers, 'labAnswers');
    if (!trials.ok || !answers.ok) return fail(422, 'Tu informe es demasiado grande. Reduce el número de ensayos o el largo de las respuestas.');

    const admin: any = createAdminSupabase();
    const { data, error } = await admin
      .from('lab_attempts')
      .insert({
        lab_id: labId,
        student_id: user.id,
        classroom_id: row.classroom_id,
        hypothesis: checked.clean.hypothesis,
        trials: trials.value,
        answers: answers.value,
        conclusion: checked.clean.conclusion,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return fail(409, 'Ya entregaste el informe de este laboratorio.');
      console.error('[lab/attempt] insert:', error.message);
      return fail(500, 'No se pudo guardar el informe. Inténtalo de nuevo.');
    }
    return NextResponse.json({ ok: true, id: data.id });
  } catch (e) {
    console.error('[lab/attempt] error:', e);
    return fail(500, 'Error inesperado.');
  }
}
