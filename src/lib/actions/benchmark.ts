'use server';

// Perfil de la clase y consentimiento para la memoria global anonima (fase 7 de «IA que aprende»). Solo el profesor dueno de la clase (comprobado aqui y por la RLS de la tabla).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import { CONSENT_VERSION, parseProfile } from '@/lib/aiLearning/benchmark';

export interface BenchmarkActionResult {
  ok: boolean;
  error?: string;
}

export async function saveBenchmarkProfile(classroomId: string, input: { subject?: unknown; level?: unknown; ageBand?: unknown; share?: unknown }): Promise<BenchmarkActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: own } = await supabase.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
  if (!own) return { ok: false, error: 'Clase no encontrada.' };
  const profile = parseProfile(input);
  if (!profile) return { ok: false, error: 'Elige materia, nivel y edad de la lista.' };
  const share = input.share === true;

  const db = supabase as any;
  const { data: prev } = await db.from('classroom_benchmark_profile').select('share_opt_in, opted_in_at, consent_version, opted_in_by, subject, level, age_band').eq('classroom_id', classroomId).maybeSingle();
  const row: Record<string, unknown> = {
    classroom_id: classroomId,
    subject: profile.subject,
    level: profile.level,
    age_band: profile.ageBand,
    share_opt_in: share,
    updated_at: new Date().toISOString(),
  };
  if (share) {
    // El consentimiento se registra al activarlo (quien, cuando, que version del texto); si ya estaba activo, con el mismo estrato y la misma version del texto, se conserva el registro original.
    const sameStratum = prev?.subject === profile.subject && prev?.level === profile.level && prev?.age_band === profile.ageBand;
    const keep = prev?.share_opt_in === true && prev.consent_version === CONSENT_VERSION && sameStratum;
    row.opted_in_at = keep ? prev.opted_in_at : new Date().toISOString();
    row.opted_in_by = keep ? prev.opted_in_by : user.id;
    row.consent_version = CONSENT_VERSION;
  }
  const { error } = await db.from('classroom_benchmark_profile').upsert(row, { onConflict: 'classroom_id' });
  if (error) return { ok: false, error: error.message };

  // Revocar (o aportar) se refleja DE INMEDIATO: se recalcula el agregado con los umbrales por defecto. Si falla, el siguiente recalculo desde /dev lo corrige.
  let warning: string | undefined;
  if (!hasServiceRoleKey()) warning = 'Guardado, pero el servidor no pudo recalcular la memoria global; se aplicará en el próximo recálculo.';
  else {
    try {
      const { error: rpcError } = await (createAdminSupabase() as any).rpc('recompute_global_benchmarks');
      if (rpcError) warning = 'Guardado, pero no se pudo recalcular la memoria global ahora; se aplicará en el próximo recálculo.';
    } catch {
      warning = 'Guardado, pero no se pudo recalcular la memoria global ahora; se aplicará en el próximo recálculo.';
    }
  }
  revalidatePath(`/teacher/classrooms/${classroomId}/global`);
  return { ok: true, error: warning };
}
