import { NextResponse } from 'next/server';
import { requireDevSession } from '@/lib/devAuth';
import { createAnonSupabase } from '@/lib/supabase/anon';

export async function GET() {
  if (!(await requireDevSession())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const supabase = createAnonSupabase();
  const [{ data: summary, error: summaryError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabase.rpc('dev_analytics_summary'),
    supabase.rpc('dev_list_recent_profiles', { p_limit: 30 }),
  ]);

  if (summaryError) return NextResponse.json({ error: summaryError.message }, { status: 500 });
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  return NextResponse.json({ summary, profiles: profiles ?? [] });
}
