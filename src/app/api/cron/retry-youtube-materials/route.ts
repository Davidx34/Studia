import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { processYoutubeMaterial } from '@/lib/materials/processYoutube';

// Sesion L: reintento automatico en segundo plano para materiales de
// YouTube que quedaron sin transcripcion por bloqueos transitorios de
// YouTube/Gemini (rate limiting). Los reintentos sincronos dentro del
// request de subir/reintentar (ver processYoutube.ts) ya absorben algunos
// casos, pero cuando el bloqueo dura mas de unos segundos no alcanzan.
//
// Este endpoint lo llama un cron job de Postgres (pg_cron + pg_net) cada
// pocos minutos, autenticado con CRON_SECRET. Al estar espaciado en el
// tiempo (a diferencia de los reintentos sincronos, que ocurren en
// segundos), le da tiempo real a que el bloqueo transitorio se levante.
//
// No requiere sesion de usuario (lo llama Postgres, no un profesor), asi
// que usa el cliente con service role para poder actualizar materiales de
// cualquier clase.

export const maxDuration = 60;

const MAX_AUTO_RETRIES = 8;
const BATCH_SIZE = 3;

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  const { data: pending, error } = await supabase
    .from('teaching_materials')
    .select('id, external_url')
    .eq('source_type', 'youtube')
    .eq('transcript_source', 'none')
    .eq('processing_status', 'completed')
    .lt('auto_retry_count', MAX_AUTO_RETRIES)
    .order('processed_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ attempted: 0, fixed: 0 });
  }

  let fixed = 0;
  for (const material of pending) {
    if (!material.external_url) continue;
    await processYoutubeMaterial(supabase, material.id, material.external_url);

    const { data: after } = await supabase
      .from('teaching_materials')
      .select('chunk_count')
      .eq('id', material.id)
      .single();
    if ((after?.chunk_count ?? 0) > 0) fixed += 1;
  }

  return NextResponse.json({ attempted: pending.length, fixed });
}
