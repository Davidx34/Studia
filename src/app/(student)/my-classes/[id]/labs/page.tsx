import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/Card';
import { rowToItem, type LabRow } from '@/lib/lab/labRows';

// Los laboratorios PUBLICADOS de la clase, con el estado de la entrega de este estudiante. La base solo le muestra los publicados de las clases donde esta inscrito.
export default async function StudentLabsPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: enrollment } = await supabase.from('class_enrollments').select('classroom_id').eq('classroom_id', params.id).eq('student_id', user.id).maybeSingle();
  if (!enrollment) redirect('/dashboard');
  const { data: classroom } = await supabase.from('classrooms').select('name').eq('id', params.id).single();
  if (!classroom) redirect('/dashboard');

  const db: any = supabase;
  const { data: rows, error } = await db.from('labs').select('*').eq('classroom_id', params.id).eq('status', 'published').order('published_at', { ascending: false });
  const items = ((rows ?? []) as LabRow[]).map(rowToItem).filter((it) => it.lab);

  // Mis entregas (migracion 082; si aun no existe la tabla, simplemente no hay estados).
  const { data: mine } = await db.from('lab_attempts').select('lab_id, status, score').eq('student_id', user.id).eq('classroom_id', params.id);
  const byLab: Record<string, { status: string; score: number | null }> = {};
  ((mine ?? []) as { lab_id: string; status: string; score: number | null }[]).forEach((a) => (byLab[a.lab_id] = { status: a.status, score: a.score }));

  return (
    <div className="theme-scope mx-auto max-w-3xl space-y-5">
      <div>
        <Link href={`/my-classes/${params.id}`} className="text-sm text-fg-muted underline-offset-2 hover:underline">
          ← {classroom.name}
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-fg">
          <FlaskConical aria-hidden="true" className="h-6 w-6" /> Laboratorios
        </h1>
        <p className="text-fg-muted">Experimentos que tu profesor preparó. Haz tus ensayos, saca conclusiones y entrega tu informe.</p>
      </div>

      {error ? (
        <Card className="p-4 text-fg-muted">Los laboratorios todavía no están disponibles.</Card>
      ) : items.length === 0 ? (
        <Card className="p-4 text-fg-muted">Tu profesor todavía no publicó ningún laboratorio.</Card>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const mineAttempt = byLab[it.id];
            return (
              <li key={it.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-fg [overflow-wrap:anywhere]">{it.title}</p>
                    <p className="text-sm text-fg-muted">
                      {it.areaLabel} · {it.templateName}
                    </p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${mineAttempt?.status === 'reviewed' ? 'bg-success/15 text-success' : mineAttempt ? 'bg-primary/15 text-primary-text' : 'bg-surface-2 text-fg-muted'}`}
                    >
                      {mineAttempt?.status === 'reviewed' ? `Revisado${mineAttempt.score !== null ? ` · ${mineAttempt.score}/100` : ''}` : mineAttempt ? 'Entregado' : 'Sin entregar'}
                    </span>
                  </div>
                  <Link
                    href={`/my-classes/${params.id}/labs/${it.id}`}
                    className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {mineAttempt ? 'Ver mi informe' : 'Abrir'}
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
