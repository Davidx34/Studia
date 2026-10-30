import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey, MISSING_SERVICE_KEY_MESSAGE } from '@/lib/supabase/admin';
import { callStudyModel, hasStudyProvider } from '@/lib/study/generate';
import { claimMemory, releaseMemoryClaim, runMemoryBuild } from '@/lib/memory/build';
import { runInBackground } from '@/lib/server/background';
import { QUOTA_POLICIES, consumeQuota, quotaDeniedBody } from '@/lib/security/rateLimit';

// Construye (o actualiza) la memoria de UNA clase: lo que la IA sabe de la materia segun sus materiales. Solo el profesor DUEÑO de la clase; cualquier otro recibe 404.
// Responde de inmediato ("building") y el trabajo sigue en segundo plano; el panel consulta el estado cada pocos segundos. Es incremental: solo relee lo que cambio.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const classroomId = typeof body?.classroomId === 'string' ? body.classroomId : '';
    const force = body?.force === true;
    if (!UUID_RE.test(classroomId)) return NextResponse.json({ error: 'classroomId invalido' }, { status: 400 });

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
    if (!classroom) return NextResponse.json({ error: 'Clase no encontrada' }, { status: 404 });

    if (!hasStudyProvider()) return NextResponse.json({ status: 'failed', error: 'No hay un proveedor de IA configurado.' }, { status: 503 });
    if (!hasServiceRoleKey()) return NextResponse.json({ status: 'failed', error: MISSING_SERVICE_KEY_MESSAGE }, { status: 503 });

    // Las tablas nuevas aun no estan en los tipos generados de Supabase.
    const admin: any = createAdminSupabase();

    // Primero el reclamo: una peticion "ocupada" (ya se esta construyendo) o en espera tras un fallo NO gasta IA, asi que tampoco le descuenta cupo al profesor.
    const claim = await claimMemory(admin, classroomId, force);
    if (claim.state === 'busy') return NextResponse.json({ status: 'building' });
    if (claim.state === 'cooldown') return NextResponse.json({ status: 'failed', error: claim.error });

    // Limite de uso POR PROFESOR (migracion 080): cada pasada lee bloques con la IA. Ya se comprobo que es el dueño de la clase (404 si no) y que hay proveedor y llave de servicio,
    // y se consume ANTES de gastar nada. Si se pasa del limite, se DEVUELVE el reclamo (la fila vuelve a como estaba) para que el panel no se quede "construyendo". Si la base no
    // responde, rateLimit.ts usa un respaldo en memoria.
    const quota = await consumeQuota((fn, args) => admin.rpc(fn, args), user.id, QUOTA_POLICIES.memoryBuild);
    if (!quota.allowed) {
      await releaseMemoryClaim(admin, classroomId, claim);
      return NextResponse.json(quotaDeniedBody(quota.retryAfterSeconds, 'actualizar la memoria'), { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } });
    }

    runInBackground(runMemoryBuild(admin, classroomId, callStudyModel, { force }));
    return NextResponse.json({ status: 'building' });
  } catch (e) {
    console.error('[memory/build] error:', e);
    return NextResponse.json({ status: 'failed', error: 'Error inesperado.' }, { status: 500 });
  }
}
