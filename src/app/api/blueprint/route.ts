import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey, MISSING_SERVICE_KEY_MESSAGE } from '@/lib/supabase/admin';
import { publishDraft, saveDraft } from '@/lib/blueprint/store';
import { supabaseBlueprintDb } from '@/lib/blueprint/storeDb';

// Guardar el borrador del plan del curso y publicarlo. SOLO el profesor DUEÑO de la clase (cualquier otro recibe 404). El navegador no escribe estas tablas (migracion 085): aqui se
// comprueba la sesion y la propiedad, se valida todo el documento y recien entonces se escribe con la llave de servicio. Leer el plan NO pasa por aqui: lo hace el navegador con su sesion
// y la RLS (el profesor ve sus versiones; el estudiante, solo el publicado de sus clases).
export const maxDuration = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_CHARS = 500_000;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return fail(413, 'El plan es demasiado grande.');
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(400, 'JSON invalido');
    }
    const action = body?.action;
    const classroomId = typeof body?.classroomId === 'string' ? body.classroomId : '';
    if (action !== 'save' && action !== 'publish') return fail(400, 'accion invalida');
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
    const db = supabaseBlueprintDb(createAdminSupabase());

    if (action === 'save') {
      const r = await saveDraft(db, { classroomId, teacherId: user.id }, body?.blueprint);
      if (!r.ok) return fail(r.status, 'El plan no es valido.', { errors: r.errors });
      return NextResponse.json({ ok: true, version: r.version, created: r.created, publishable: r.publishable, issues: r.issues });
    }

    const r = await publishDraft(db, { classroomId });
    if (!r.ok) return fail(r.status, r.error, r.issues ? { issues: r.issues } : {});
    return NextResponse.json({ ok: true, version: r.version, archivedVersion: r.archivedVersion, issues: r.issues });
  } catch (e) {
    console.error('[blueprint] error:', e instanceof Error ? e.message : 'desconocido');
    return fail(500, 'Error inesperado.');
  }
}
