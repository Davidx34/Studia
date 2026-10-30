import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/Card';
import { rowToItem, type LabRow } from '@/lib/lab/labRows';
import { parseAttemptState } from '@/lib/lab/protocol';
import LabRunner from './LabRunner';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un laboratorio publicado: el estudiante hace sus ensayos y entrega el informe. Si ya entrego, lo ve en solo lectura con la nota y el comentario del profesor.
export default async function StudentLabPage({ params }: { params: { id: string; labId: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!UUID_RE.test(params.labId)) redirect(`/my-classes/${params.id}/labs`);

  const { data: enrollment } = await supabase.from('class_enrollments').select('classroom_id').eq('classroom_id', params.id).eq('student_id', user.id).maybeSingle();
  if (!enrollment) redirect('/dashboard');

  const db: any = supabase;
  const { data: row } = await db.from('labs').select('*').eq('id', params.labId).eq('classroom_id', params.id).eq('status', 'published').maybeSingle();
  const lab = row ? rowToItem(row as LabRow).lab : null;
  if (!row || !lab) redirect(`/my-classes/${params.id}/labs`);

  const { data: attempt } = await db
    .from('lab_attempts')
    .select('hypothesis, trials, answers, conclusion, status, score, teacher_feedback')
    .eq('lab_id', params.labId)
    .eq('student_id', user.id)
    .maybeSingle();
  // El estado guardado se vuelve a pasar por el mismo validador de forma que usa el protocolo (no se confia en lo guardado).
  const submitted = attempt ? parseAttemptState({ hypothesis: attempt.hypothesis, trials: attempt.trials, answers: attempt.answers, conclusion: attempt.conclusion }) : null;

  return (
    <div className="theme-scope mx-auto max-w-5xl space-y-4">
      <Link href={`/my-classes/${params.id}/labs`} className="text-sm text-fg-muted underline-offset-2 hover:underline">
        ← Laboratorios
      </Link>
      {attempt && (
        <Card className="space-y-1 p-4">
          <p className="font-semibold text-fg">{attempt.status === 'reviewed' ? `Tu profesor revisó tu informe: ${attempt.score}/100` : 'Entregaste tu informe. Tu profesor lo revisará.'}</p>
          {attempt.teacher_feedback && <p className="text-fg-muted [overflow-wrap:anywhere]">{attempt.teacher_feedback}</p>}
        </Card>
      )}
      <LabRunner labId={params.labId} userId={user.id} lab={lab} submitted={submitted} />
    </div>
  );
}
