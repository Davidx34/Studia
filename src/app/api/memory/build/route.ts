import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey, MISSING_SERVICE_KEY_MESSAGE } from '@/lib/supabase/admin';
import { callStudyModel, hasStudyProvider } from '@/lib/study/generate';
import { claimMemory, runMemoryBuild } from '@/lib/memory/build';
import { runInBackground } from '@/lib/server/background';

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
    const claim = await claimMemory(admin, classroomId, force);
    if (claim.state === 'busy') return NextResponse.json({ status: 'building' });
    if (claim.state === 'cooldown') return NextResponse.json({ status: 'failed', error: claim.error });

    runInBackground(runMemoryBuild(admin, classroomId, callStudyModel, { force }));
    return NextResponse.json({ status: 'building' });
  } catch (e) {
    console.error('[memory/build] error:', e);
    return NextResponse.json({ status: 'failed', error: 'Error inesperado.' }, { status: 500 });
  }
}
