import { NextRequest, NextResponse } from 'next/server';
import { requireDevSession } from '@/lib/devAuth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireDevSession())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc('dev_delete_pending_registration', { p_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
