import { NextRequest, NextResponse } from 'next/server';
import { requireDevSession } from '@/lib/devAuth';
import { createAnonSupabase } from '@/lib/supabase/anon';

export async function GET() {
  if (!(await requireDevSession())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const supabase = createAnonSupabase();
  const { data, error } = await supabase.rpc('dev_list_pending_registrations');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ registrations: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!(await requireDevSession())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { email, role } = await req.json();
  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Email invalido' }, { status: 400 });
  }
  if (role !== 'student' && role !== 'teacher') {
    return NextResponse.json({ error: 'Rol invalido' }, { status: 400 });
  }

  const supabase = createAnonSupabase();
  const { data, error } = await supabase.rpc('dev_add_pending_registration', {
    p_email: email,
    p_role: role,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ registration: data });
}
