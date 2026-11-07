import { NextResponse } from 'next/server';
import { requireDevSession } from '@/lib/devAuth';
import { createAdminSupabase } from '@/lib/supabase/admin';

// Estado de «IA que aprende» desde el panel /dev (sesion propia del panel; ver src/lib/devAuth.ts) y recalculo de question_stats.
// GET = conteos (solo numeros, nada de contenido). POST { action: 'recompute' } llama a recompute_question_stats() (migracion 096): recalcula desde cero, excluye la clase [CARGA]; es seguro repetirlo.
export const maxDuration = 60;

const db = () => createAdminSupabase() as any;
const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
};

async function status() {
  const admin = db();
  const [events, judge, teacher, stats, lastStat, playbooks, cycles] = await Promise.all([
    count(admin.from('ai_feedback_events').select('*', { count: 'exact', head: true })),
    count(admin.from('ai_feedback_events').select('*', { count: 'exact', head: true }).eq('signal', 'judge')),
    count(admin.from('ai_feedback_events').select('*', { count: 'exact', head: true }).eq('signal', 'teacher')),
    count(admin.from('question_stats').select('*', { count: 'exact', head: true })),
    admin.from('question_stats').select('computed_at').order('computed_at', { ascending: false }).limit(1).maybeSingle(),
    count(admin.from('ai_playbooks').select('*', { count: 'exact', head: true }).eq('status', 'active')),
    count(admin.from('course_cycles').select('*', { count: 'exact', head: true })),
  ]);
  return {
    feedbackEvents: { total: events, judge, teacher },
    questionStats: { rows: stats, lastComputedAt: lastStat?.data?.computed_at ?? null },
    activePlaybooks: playbooks,
    closedCycles: cycles,
  };
}

export async function GET() {
  if (!(await requireDevSession())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    return NextResponse.json(await status());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await requireDevSession())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body?.action !== 'recompute') return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
  try {
    const { data, error } = await db().rpc('recompute_question_stats');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ recomputed: Number(data ?? 0), ...(await status()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
