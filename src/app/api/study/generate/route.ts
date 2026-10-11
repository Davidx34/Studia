import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey, MISSING_SERVICE_KEY_MESSAGE } from '@/lib/supabase/admin';
import { hasStudyProvider } from '@/lib/study/generate';
import { claimJob, runJob, type JobKind } from '@/lib/study/jobs';
import { runInBackground } from '@/lib/server/background';

// Material de estudio (fichas + flashcards, o infografias) de UN material. Lo genera SOLO el profesor dueño del
// material: los estudiantes unicamente ven lo ya hecho. Responde de inmediato ("generating") y el trabajo sigue en
// segundo plano; el panel del profesor consulta el estado cada pocos segundos.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const materialId = typeof body?.materialId === 'string' ? body.materialId : '';
    const kind: JobKind = body?.kind === 'infographics' ? 'infographics' : 'cards';
    const force = body?.force === true;
    if (!UUID_RE.test(materialId)) return NextResponse.json({ error: 'materialId invalido' }, { status: 400 });

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    // Solo el profesor dueño: un estudiante (o un profesor ajeno) recibe 404, como si el material no existiera.
    const { data: material } = await supabase
      .from('teaching_materials')
      .select('id, display_name, processing_status')
      .eq('id', materialId)
      .eq('teacher_id', user.id)
      .maybeSingle();
    if (!material) return NextResponse.json({ error: 'Material no encontrado' }, { status: 404 });
    if (material.processing_status !== 'completed') return NextResponse.json({ error: 'El material aún no está procesado' }, { status: 409 });

    if (!hasStudyProvider()) return NextResponse.json({ status: 'failed', error: 'No hay un proveedor de IA configurado.' }, { status: 503 });
    // Sin la llave de servicio el trabajo en segundo plano no puede escribir: se dice con claridad (antes: "Error inesperado").
    if (!hasServiceRoleKey()) return NextResponse.json({ status: 'failed', error: MISSING_SERVICE_KEY_MESSAGE }, { status: 503 });

    // Las tablas nuevas aun no estan en los tipos generados de Supabase.
    const admin: any = createAdminSupabase();
    const claim = await claimJob(admin, kind, materialId, force);
    if (claim.state === 'ready') return NextResponse.json({ status: 'ready', cards: claim.cards });
    if (claim.state === 'busy') return NextResponse.json({ status: 'generating' });
    if (claim.state === 'cooldown') return NextResponse.json({ status: 'failed', error: claim.error });

    runInBackground(runJob(admin, kind, { id: material.id, display_name: material.display_name }));
    return NextResponse.json({ status: 'generating' });
  } catch (e) {
    console.error('[study/generate] error:', e);
    return NextResponse.json({ status: 'failed', error: 'Error inesperado.' }, { status: 500 });
  }
}
