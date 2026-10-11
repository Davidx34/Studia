import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { groupChunks } from '@/lib/study/grouping';
import { callStudyModel, hasStudyProvider } from '@/lib/study/generate';
import { generateInfographics, infographicRow } from '@/lib/study/infographics';

// Infografias del material (cronologias, comparativas, procesos, cifras), generadas UNA vez como DATOS y
// compartidas por todos los inscritos. Mismo esquema de reclamo atomico que /api/study/generate.
export const maxDuration = 300;

const STALE_GENERATING_MS = 6 * 60 * 1000;
const RETRY_COOLDOWN_MS = 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE = 'study_infographic_generation';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const materialId = typeof body?.materialId === 'string' ? body.materialId : '';
    if (!UUID_RE.test(materialId)) return NextResponse.json({ error: 'materialId invalido' }, { status: 400 });

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    // El RLS decide si el usuario ve el material (inscrito o dueño).
    const { data: material } = await supabase.from('teaching_materials').select('id, display_name, processing_status').eq('id', materialId).maybeSingle();
    if (!material) return NextResponse.json({ error: 'Material no encontrado' }, { status: 404 });
    if (material.processing_status !== 'completed') return NextResponse.json({ error: 'El material aun no esta procesado' }, { status: 409 });

    const admin: any = createAdminSupabase();
    const { data: current } = await admin.from(TABLE).select('*').eq('material_id', materialId).maybeSingle();
    const now = Date.now();

    if (current?.status === 'ready') return NextResponse.json({ status: 'ready', cards: current.card_count });
    if (current?.status === 'generating' && now - new Date(current.started_at).getTime() < STALE_GENERATING_MS) return NextResponse.json({ status: 'generating' });
    if (current?.status === 'failed' && current.finished_at && now - new Date(current.finished_at).getTime() < RETRY_COOLDOWN_MS) {
      return NextResponse.json({ status: 'failed', error: current.error ?? 'No se pudieron generar las infografias' });
    }
    if (!hasStudyProvider()) return NextResponse.json({ status: 'failed', error: 'No hay un proveedor de IA configurado' }, { status: 503 });

    // Reclamo atomico (compare-and-set): solo UNA peticion pasa a "generating".
    const startedAt = new Date().toISOString();
    if (!current) {
      const { error } = await admin.from(TABLE).insert({ material_id: materialId, status: 'generating', started_at: startedAt });
      if (error) return NextResponse.json({ status: 'generating' });
    } else {
      const { data: claimed } = await admin
        .from(TABLE)
        .update({ status: 'generating', started_at: startedAt, finished_at: null, error: null })
        .eq('material_id', materialId)
        .eq('status', current.status)
        .eq('started_at', current.started_at)
        .select('material_id');
      if (!claimed || claimed.length === 0) return NextResponse.json({ status: 'generating' });
    }

    const fail = async (message: string) => {
      await admin.from(TABLE).update({ status: 'failed', finished_at: new Date().toISOString(), error: message }).eq('material_id', materialId);
      return NextResponse.json({ status: 'failed', error: message });
    };

    const { data: chunks } = await admin.from('material_chunks').select('chunk_index, content').eq('material_id', materialId).order('chunk_index');
    const groups = groupChunks(chunks ?? []);
    if (groups.length === 0) return fail('El material no tiene texto suficiente para armar infografias.');

    const generated = await generateInfographics(groups, material.display_name ?? 'Material', callStudyModel);
    // No todo material se presta a una infografia: decirlo claro vale mas que inventar una.
    if (generated.items.length === 0) return fail('Este material no tiene datos que se presten a una infografia (fechas, comparaciones, pasos o cifras).');

    const rows = generated.items.map((it, i) => infographicRow(materialId, it, i));
    await admin.from('study_cards').delete().eq('material_id', materialId).eq('kind', 'infografia');
    const { error: insertError } = await admin.from('study_cards').insert(rows);
    if (insertError) return fail('No se pudieron guardar las infografias.');

    await admin.from(TABLE).update({ status: 'ready', finished_at: new Date().toISOString(), card_count: rows.length }).eq('material_id', materialId);
    return NextResponse.json({ status: 'ready', cards: rows.length });
  } catch (e) {
    console.error('[study/infographics] error:', e);
    return NextResponse.json({ status: 'failed', error: 'Error inesperado generando las infografias' }, { status: 500 });
  }
}
