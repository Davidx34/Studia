import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import { loadPracticeQuestions, type PracticeData } from '@/lib/practice/load';
import { Card } from '@/components/ui/Card';
import { PracticeClient } from './PracticeClient';

// Modo practica: solo lectura. Nada de lo que se responde aqui se guarda.
export default async function PracticePage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: enrollment } = await supabase
    .from('class_enrollments')
    .select('classroom_id')
    .eq('classroom_id', params.id)
    .eq('student_id', user.id)
    .maybeSingle();
  if (!enrollment) redirect('/dashboard');

  const { data: classroom } = await supabase.from('classrooms').select('name').eq('id', params.id).single();
  if (!classroom) redirect('/dashboard');

  // Con llave de servicio, las claves se leen desde el servidor (asi sigue funcionando cuando se cierre la lectura de claves
  // a los estudiantes); sin ella, con el cliente del usuario (RLS). En ambos casos solo de SUS preguntas ya respondidas.
  let data: PracticeData | null = null;
  try {
    const db = hasServiceRoleKey() ? createAdminSupabase() : supabase;
    data = await loadPracticeQuestions(db, { studentId: user.id, classroomId: params.id });
  } catch (e) {
    console.warn('[practice]', e instanceof Error ? e.message : e);
  }

  const backLink = (
    <Link href={`/my-classes/${params.id}`} className="inline-flex items-center min-h-[44px] text-sm font-medium text-primary-text underline underline-offset-4">
      Volver a la clase
    </Link>
  );

  if (!data) {
    return (
      <div className="theme-scope max-w-2xl mx-auto space-y-4">
        <Card className="p-6 space-y-2" role="alert">
          <h1 className="text-xl font-bold text-fg">No pude cargar tu práctica</h1>
          <p className="text-fg-muted text-sm">Intenta de nuevo en unos minutos.</p>
          {backLink}
        </Card>
      </div>
    );
  }

  if (data.questions.length === 0) {
    return (
      <div className="theme-scope max-w-2xl mx-auto space-y-4">
        <Card className="p-6 space-y-2">
          <h1 className="text-xl font-bold text-fg">Aún no hay nada que practicar</h1>
          <p className="text-fg-muted text-sm">
            La práctica usa preguntas que ya respondiste en las lecciones de {classroom.name}. Completa alguna lección y vuelve.
          </p>
          {backLink}
        </Card>
      </div>
    );
  }

  return (
    <PracticeClient
      questions={data.questions}
      classroomId={params.id}
      classroomName={classroom.name}
      answeredTotal={data.answeredTotal}
      wrongTotal={data.wrongTotal}
    />
  );
}
