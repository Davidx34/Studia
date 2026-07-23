import { NextResponse } from 'next/server';
import { requireDevSession } from '@/lib/devAuth';
import { createAnonSupabase } from '@/lib/supabase/anon';

// Solo expone booleans de configuracion (nunca los valores de las keys) y un
// chequeo simple de conectividad a la base.
export async function GET() {
  if (!(await requireDevSession())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const supabase = createAnonSupabase();
  const start = Date.now();
  const { error: dbError } = await supabase.rpc('dev_analytics_summary');
  const dbLatencyMs = Date.now() - start;

  return NextResponse.json({
    env: {
      cohere: !!process.env.COHERE_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      devAuth: !!process.env.DEV_PASSWORD && !!process.env.DEV_SESSION_SECRET,
      supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    database: {
      ok: !dbError,
      latencyMs: dbLatencyMs,
      error: dbError?.message ?? null,
    },
  });
}
