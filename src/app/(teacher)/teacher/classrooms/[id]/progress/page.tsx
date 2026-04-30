import { redirect } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { getClassroomProgress } from '@/lib/actions/classroom-progress';
import { createServerSupabase } from '@/lib/supabase/server';
import ProgressClient from './ProgressClient';

export default async function ProgressPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const result = await getClassroomProgress(params.id);
  if (!result.ok || !result.data) {
    return (
      <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-4 flex items-start gap-2 text-sm text-red-300">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{result.error ?? 'No se pudo cargar el progreso.'}</span>
      </div>
    );
  }

  return <ProgressClient data={result.data} />;
}
