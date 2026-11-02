import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey, MISSING_SERVICE_KEY_MESSAGE } from '@/lib/supabase/admin';
import { publishDraft, saveDraft } from '@/lib/blueprint/store';
import { isPublishable } from '@/lib/blueprint/validate';
import { supabaseBlueprintDb } from '@/lib/blueprint/storeDb';
import { checkBrief, generateBlueprint } from '@/lib/blueprint/generate';
import { callStudyModel, hasStudyProvider } from '@/lib/study/generate';
import { QUOTA_POLICIES, consumeQuota, quotaDeniedBody } from '@/lib/security/rateLimit';

// Guardar el borrador del plan del curso y publicarlo. SOLO el profesor DUEÑO de la clase (cualquier otro recibe 404). El navegador no escribe estas tablas (migracion 085): aqui se
// comprueba la sesion y la propiedad, se valida todo el documento y recien entonces se escribe con la llave de servicio. Leer el plan NO pasa por aqui: lo hace el navegador con su sesion
// y la RLS (el profesor ve sus versiones; el estudiante, solo el publicado de sus clases).
export const maxDuration = 120;

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
    if (action !== 'save' && action !== 'publish' && action !== 'generate') return fail(400, 'accion invalida');
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
    const admin: any = createAdminSupabase();

    // GENERAR: la IA desarrolla el borrador del profesor hacia atras. NO guarda nada (no pisa un borrador que el profesor ya edito): devuelve el plan y sus avisos para que lo revise y lo guarde.
    if (action === 'generate') {
      if (!hasStudyProvider()) return fail(503, 'No hay un proveedor de IA configurado.');
      // El cupo se consume DESPUES de validar el borrador (una peticion invalida no gasta cupo) y ANTES de llamar a la IA.
      const checked = checkBrief(body?.brief);
      if (!checked.ok) return fail(400, 'El borrador del curso no es valido.', { errors: checked.errors });
      const quota = await consumeQuota((fn, args) => admin.rpc(fn, args), user.id, QUOTA_POLICIES.blueprintGenerate);
      if (!quota.allowed) return NextResponse.json(quotaDeniedBody(quota.retryAfterSeconds, 'generar el plan del curso'), { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } });
      const g = await generateBlueprint(checked.brief, callStudyModel);
      if (!g.ok) return fail(g.reason === 'noResponse' ? 503 : 502, g.reason === 'invalid' ? 'El borrador del curso no es valido.' : g.message);
      return NextResponse.json({ ok: true, blueprint: g.blueprint, issues: g.issues, publishable: isPublishable(g.issues) });
    }

    const db = supabaseBlueprintDb(admin);

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
