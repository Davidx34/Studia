import { redirect } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { getClassroomProgress } from '@/lib/actions/classroom-progress';
import { getConceptGapData } from '@/lib/actions/concept-metrics';
import { getClassMastery } from '@/lib/actions/class-mastery';
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
      <div className="rounded-2xl bg-danger/10 border border-danger/30 p-4 flex items-start gap-2 text-sm text-danger">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{result.error ?? 'No se pudo cargar el progreso.'}</span>
      </div>
    );
  }

  // La brecha de conocimiento depende de question_attempts (Sesion B) y puede
  // no tener datos aun; se pasa hasData para que la UI lo maneje sin bloquear
  // la tabla de progreso existente si esta vista falla.
  const conceptResult = await getConceptGapData(params.id);
  // Dominio por modulo y objetivo: si falla, solo esa pestana muestra el error; el resto de la pagina sigue.
  const masteryResult = await getClassMastery(params.id);

  return (
    <ProgressClient
      data={result.data}
      conceptGap={conceptResult.ok ? conceptResult.data ?? null : null}
      mastery={masteryResult.ok ? masteryResult.data ?? null : null}
      masteryError={masteryResult.ok ? null : masteryResult.error ?? null}
    />
  );
}
