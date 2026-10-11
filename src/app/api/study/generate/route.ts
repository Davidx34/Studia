import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { groupChunks } from '@/lib/study/grouping';
import { generateStudyCards, callStudyModel, hasStudyProvider } from '@/lib/study/generate';

// Fichas de lectura + flashcards del material, generadas por IA UNA vez y compartidas por todos los inscritos
// (sin aprobacion del profesor). El primero que las pide dispara la generacion; los demas ven "preparando".
export const maxDuration = 300;

const STALE_GENERATING_MS = 6 * 60 * 1000; // una generacion "en curso" mas vieja que esto se considera caida
const RETRY_COOLDOWN_MS = 60 * 1000; // tras fallar, no se reintenta de inmediato (evita martillar al proveedor)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // El RLS decide si el usuario ve el material (inscrito o dueño): si no, es como si no existiera.
    const { data: material } = await supabase
      .from('teaching_materials')
      .select('id, display_name, processing_status')
      .eq('id', materialId)
      .maybeSingle();
    if (!material) return NextResponse.json({ error: 'Material no encontrado' }, { status: 404 });
    if (material.processing_status !== 'completed') return NextResponse.json({ error: 'El material aun no esta procesado' }, { status: 409 });

    // Las tablas nuevas aun no estan en los tipos generados de Supabase.
    const admin: any = createAdminSupabase();
    const { data: current } = await admin.from('study_card_generation').select('*').eq('material_id', materialId).maybeSingle();
    const now = Date.now();

    if (current?.status === 'ready') return NextResponse.json({ status: 'ready', cards: current.card_count });
    if (current?.status === 'generating' && now - new Date(current.started_at).getTime() < STALE_GENERATING_MS) {
      return NextResponse.json({ status: 'generating' });
    }
    if (current?.status === 'failed' && current.finished_at && now - new Date(current.finished_at).getTime() < RETRY_COOLDOWN_MS) {
      return NextResponse.json({ status: 'failed', error: current.error ?? 'No se pudieron generar las fichas' });
    }

    if (!hasStudyProvider()) return NextResponse.json({ status: 'failed', error: 'No hay un proveedor de IA configurado' }, { status: 503 });

    // Reclamo atomico: solo UNA peticion pasa de (nada | failed | generating vencido) a generating.
    const startedAt = new Date().toISOString();
    if (!current) {
      const { error } = await admin.from('study_card_generation').insert({ material_id: materialId, status: 'generating', started_at: startedAt });
      if (error) return NextResponse.json({ status: 'generating' }); // otra peticion lo reclamo primero
    } else {
      const { data: claimed } = await admin
        .from('study_card_generation')
        .update({ status: 'generating', started_at: startedAt, finished_at: null, error: null })
        .eq('material_id', materialId)
        .eq('status', current.status)
        .eq('started_at', current.started_at)
        .select('material_id');
      if (!claimed || claimed.length === 0) return NextResponse.json({ status: 'generating' });
    }

    const fail = async (message: string) => {
      await admin.from('study_card_generation').update({ status: 'failed', finished_at: new Date().toISOString(), error: message }).eq('material_id', materialId);
      return NextResponse.json({ status: 'failed', error: message });
    };

    const { data: chunks } = await admin.from('material_chunks').select('chunk_index, content').eq('material_id', materialId).order('chunk_index');
    const groups = groupChunks(chunks ?? []);
    if (groups.length === 0) return fail('El material no tiene texto suficiente para armar fichas.');

    const generated = await generateStudyCards(groups, material.display_name ?? 'Material', callStudyModel);
    const rows = [
      ...generated.fichas.map((c, i) => ({ material_id: materialId, kind: 'ficha' as const, section: c.section, position: i, front: c.front, back: c.back, extra: c.extra })),
      ...generated.flashcards.map((c, i) => ({ material_id: materialId, kind: 'flashcard' as const, section: c.section, position: i, front: c.front, back: c.back, extra: {} })),
    ];
    if (rows.length === 0) return fail('La IA no devolvio tarjetas validas. Intenta de nuevo en un minuto.');

    // Reemplazo completo: borra lo anterior (si lo habia de un intento viejo) e inserta lo nuevo.
    await admin.from('study_cards').delete().eq('material_id', materialId).in('kind', ['ficha', 'flashcard']);
    const { error: insertError } = await admin.from('study_cards').insert(rows);
    if (insertError) return fail('No se pudieron guardar las tarjetas.');

    const note = generated.groupsFailed > 0 ? `${generated.groupsFailed} de ${groups.length} bloques no se pudieron procesar` : null;
    await admin
      .from('study_card_generation')
      .update({ status: 'ready', finished_at: new Date().toISOString(), card_count: rows.length, error: note })
      .eq('material_id', materialId);
    return NextResponse.json({ status: 'ready', cards: rows.length });
  } catch (e) {
    console.error('[study/generate] error:', e);
    return NextResponse.json({ status: 'failed', error: 'Error inesperado generando las fichas' }, { status: 500 });
  }
}
