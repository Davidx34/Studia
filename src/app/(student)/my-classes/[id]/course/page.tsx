import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/Card';
import { CourseJourney } from '@/components/student/CourseJourney';
import { loadCourseData } from '@/lib/blueprint/studentData';
import { buildCourseView } from '@/lib/blueprint/studentView';

// Recorrido del curso por cortes (solo lectura). El estudiante ve SU avance en el plan PUBLICADO de una clase donde esta matriculado. Los intentos de las lecciones solo los lee el
// servidor (lesson_attempts no tiene permisos para el navegador) y siempre filtrados por el estudiante de la sesion.
export default async function StudentCoursePage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: enrollment } = await supabase.from('class_enrollments').select('id').eq('classroom_id', params.id).eq('student_id', user.id).maybeSingle();
  if (!enrollment) redirect('/dashboard');

  const { data: classroom } = await supabase.from('classrooms').select('name').eq('id', params.id).maybeSingle();
  if (!classroom) redirect('/dashboard');

  const admin = hasServiceRoleKey() ? createAdminSupabase() : null;
  const data = await loadCourseData({ db: supabase, admin, classroomId: params.id, studentId: user.id });

  const back = (
    <Link href={`/my-classes/${params.id}`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary-text underline-offset-4 hover:underline">
      ← Volver a la clase
    </Link>
  );

  if (data.status !== 'ok') {
    return (
      <div className="theme-scope space-y-4">
        {back}
        <Card className="p-5">
          <h1 className="text-xl font-bold text-fg">Recorrido del curso</h1>
          <p className="mt-2 text-fg-muted">
            {data.status === 'noPlan' ? 'Tu profesor todavía no ha publicado un plan por cortes para esta clase.' : 'No pudimos leer el plan de esta clase. Intenta de nuevo más tarde.'}
          </p>
        </Card>
      </div>
    );
  }

  const view = buildCourseView({ plan: data.plan, links: data.links, moduleAttempts: data.moduleAttempts, periodExamAttempts: data.periodExamAttempts, finalExamAttempts: data.finalExamAttempts });
  return (
    <div className="theme-scope space-y-4">
      {back}
      <CourseJourney view={view} className={classroom.name ?? ''} version={data.version} scoresAvailable={data.scoresAvailable} />
    </div>
  );
}
