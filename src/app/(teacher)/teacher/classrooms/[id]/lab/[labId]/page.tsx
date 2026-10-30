import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { rowToItem, type LabRow } from '@/lib/lab/labRows';
import { parseAttemptState } from '@/lib/lab/protocol';
import AttemptsReview, { type AttemptView } from './AttemptsReview';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Las entregas de un laboratorio de la clase. Solo el profesor dueño: la politica de la base ya le limita las filas, y aqui ademas se comprueba la clase.
export default async function LabAttemptsPage({ params }: { params: { id: string; labId: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!UUID_RE.test(params.labId)) redirect(`/teacher/classrooms/${params.id}/lab`);

  const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', params.id).eq('teacher_id', user.id).maybeSingle();
  if (!classroom) redirect('/teacher/classrooms');

  const db: any = supabase;
  const { data: row } = await db.from('labs').select('*').eq('id', params.labId).eq('classroom_id', params.id).maybeSingle();
  const lab = row ? rowToItem(row as LabRow).lab : null;
  if (!row || !lab) redirect(`/teacher/classrooms/${params.id}/lab`);

  const { data: rows, error } = await db
    .from('lab_attempts')
    .select('id, student_id, hypothesis, trials, answers, conclusion, status, score, teacher_feedback, created_at')
    .eq('lab_id', params.labId)
    .order('created_at', { ascending: true });

  const studentIds = Array.from(new Set(((rows ?? []) as { student_id: string }[]).map((r) => r.student_id)));
  const { data: profiles } = studentIds.length ? await supabase.from('profiles').select('id, full_name, username').in('id', studentIds) : { data: [] as any[] };
  const nameOf: Record<string, string> = {};
  (profiles ?? []).forEach((p: any) => (nameOf[p.id] = p.full_name || p.username || 'Estudiante'));

  const attempts: AttemptView[] = ((rows ?? []) as any[])
    .map((r) => ({
      id: r.id as string,
      studentName: nameOf[r.student_id] ?? 'Estudiante',
      createdAt: r.created_at as string,
      status: (r.status === 'reviewed' ? 'reviewed' : 'submitted') as 'reviewed' | 'submitted',
      score: r.score === null || r.score === undefined ? null : Number(r.score),
      feedback: (r.teacher_feedback as string | null) ?? '',
      // Se vuelve a pasar por el parser del protocolo: nada de lo guardado se muestra sin validar su forma.
      state: parseAttemptState({ hypothesis: r.hypothesis, trials: r.trials, answers: r.answers, conclusion: r.conclusion }),
    }))
    .filter((a) => a.state);

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/teacher/classrooms/${params.id}/lab`} className="text-sm text-fg-muted underline-offset-2 hover:underline">
          ← Laboratorios
        </Link>
        <h2 className="mt-1 text-xl font-bold text-fg [overflow-wrap:anywhere]">Entregas: {lab.title}</h2>
      </div>
      {error ? (
        <p className="rounded-xl border border-line bg-surface-2 p-4 text-fg-muted">Las entregas todavía no están disponibles.</p>
      ) : (
        <AttemptsReview lab={lab} attempts={attempts} />
      )}
    </div>
  );
}
