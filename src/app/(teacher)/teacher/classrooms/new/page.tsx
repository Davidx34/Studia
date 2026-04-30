import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import NewClassroomForm from './NewClassroomForm';

export default async function NewClassroomPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link
        href="/teacher/classrooms"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver a Mis clases
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-white">Nueva clase</h1>
        <p className="text-slate-400 mt-1">
          Crea una clase, invita estudiantes y sube material para que la IA
          arme un mapa de aprendizaje personalizado.
        </p>
      </div>

      <NewClassroomForm />
    </div>
  );
}
