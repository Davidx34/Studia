import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/Card';
import { parseBlueprint } from '@/lib/blueprint/parse';
import ExamClient from './ExamClient';

// Pantalla de una evaluacion (de un corte o la final) del plan por cortes. Solo LEE el plan publicado con la sesion del estudiante (RLS de la migracion 085: solo ve el plan PUBLICADO de una
// clase donde esta matriculado). Las preguntas y las respuestas viajan por /api/exam, nunca por aqui.
export default async function StudentExamPage({ params }: { params: { id: string; examId: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: enrollment } = await supabase.from('class_enrollments').select('id').eq('classroom_id', params.id).eq('student_id', user.id).maybeSingle();
  if (!enrollment) redirect('/dashboard');

  const back = (
    <Link href={`/my-classes/${params.id}/course`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary-text underline-offset-4 hover:underline">
      ← Volver al recorrido del curso
    </Link>
  );

  const db: any = supabase;
  const { data: plans } = await db.from('course_blueprints').select('doc').eq('classroom_id', params.id).eq('status', 'published').maybeSingle();
  const parsed = plans ? parseBlueprint(plans.doc) : null;
  const plan = parsed && parsed.ok ? parsed.blueprint : null;
  const period = plan && params.examId !== 'final' ? plan.periods.find((p) => p.id === params.examId) : null;

  if (!plan || (params.examId !== 'final' && !period)) {
    return (
      <div className="theme-scope space-y-4">
        {back}
        <Card className="p-5">
          <h1 className="text-xl font-bold text-fg">Evaluación</h1>
          <p className="mt-2 text-fg-muted">Esta evaluación no está disponible. Puede que tu profesor haya cambiado el plan del curso.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="theme-scope space-y-4">
      {back}
      <ExamClient classroomId={params.id} kind={params.examId === 'final' ? 'final' : 'period'} periodId={period?.id ?? null} title={period ? `Evaluación del corte «${period.name}»` : 'Evaluación final'} backHref={`/my-classes/${params.id}/course`} />
    </div>
  );
}
