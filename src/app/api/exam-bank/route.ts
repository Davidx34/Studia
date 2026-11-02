import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey, MISSING_SERVICE_KEY_MESSAGE } from '@/lib/supabase/admin';
import { reviewQuestion } from '@/lib/blueprint/examBank';
import { supabaseBankDb } from '@/lib/blueprint/examBankDb';
import { generateAndStore } from '@/lib/blueprint/examFlow';
import { retrieveExamChunks } from '@/lib/blueprint/examChunks';
import { callJudgeModel, hasJudgeProvider } from '@/lib/blueprint/examJudgeModel';
import { supabaseBlueprintDb } from '@/lib/blueprint/storeDb';
import { callStudyModel, hasStudyProvider } from '@/lib/study/generate';
import { QUOTA_POLICIES, consumeQuota, quotaDeniedBody } from '@/lib/security/rateLimit';

// Banco de preguntas de examen. SOLO el profesor DUEÑO de la clase (cualquier otro recibe 404). Acciones:
//   - review:   aprobar o rechazar UNA pregunta.
//   - generate: la IA escribe preguntas para UNA comprension en UN modulo, apoyadas en el material de la clase, pasan por el juez de sustento y se guardan PENDIENTES de revision.
// Leer el banco NO pasa por aqui: lo hace el navegador con su sesion y la RLS de la migracion 088 (solo el profesor dueño ve las preguntas; un estudiante, JAMAS: tienen las claves).
// El navegador no escribe la tabla. Ninguna respuesta devuelve el contenido de una pregunta.
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
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
    const action = body?.action;
    if (action !== 'review' && action !== 'generate') return fail(400, 'accion invalida');
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
    const admin: any = createAdminSupabase();

    if (action === 'review') {
      const r = await reviewQuestion(supabaseBankDb(admin), { classroomId, reviewerId: user.id }, body?.questionId, body?.decision);
      if (!r.ok) return fail(r.status, r.error);
      return NextResponse.json({ ok: true, status: r.status });
    }

    // GENERAR. Primero lo barato (forma de los ids y proveedor de IA) y DESPUES el cupo: una peticion invalida no gasta cupo.
    if (typeof body?.outcomeId !== 'string' || !ID_RE.test(body.outcomeId) || typeof body?.nodeId !== 'string' || !ID_RE.test(body.nodeId)) return fail(400, 'La comprension o el modulo no son validos.');
    if (!hasStudyProvider()) return fail(503, 'No hay un proveedor de IA configurado.');
    const quota = await consumeQuota((fn, args) => admin.rpc(fn, args), user.id, QUOTA_POLICIES.examGenerate);
    if (!quota.allowed) return NextResponse.json(quotaDeniedBody(quota.retryAfterSeconds, 'generar preguntas de examen'), { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } });

    const r = await generateAndStore(
      {
        plans: supabaseBlueprintDb(admin),
        bank: supabaseBankDb(admin),
        retrieve: (query) => retrieveExamChunks(admin, { classroomId, query }),
        model: callStudyModel,
        // Sin un proveedor distinto del que escribe, no hay juez: las preguntas se guardan como "no juzgadas" (NO aprobadas) y la respuesta lo dice.
        judge: hasJudgeProvider() ? callJudgeModel : undefined,
      },
      { classroomId },
      { outcomeId: body.outcomeId, nodeId: body.nodeId, count: body?.count }
    );
    if (!r.ok) return fail(r.status, r.error);
    const { ok: _ok, ...summary } = r;
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error('[exam-bank] error:', e instanceof Error ? e.message : 'desconocido');
    return fail(500, 'Error inesperado.');
  }
}
