'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

type State = {
  feedbackEvents: { total: number; judge: number; teacher: number };
  questionStats: { rows: number; lastComputedAt: string | null };
  activePlaybooks: number;
  closedCycles: number;
};

// Pestaña «IA que aprende»: conteos de lo que se acumula (señales del juez y del profesor, estadísticas por pregunta, cuadernos activos, ciclos cerrados) y el botón que recalcula question_stats.
export default function AiLearningTab() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/dev/ai-learning');
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? 'No se pudo cargar');
    setState(json);
  }
  useEffect(() => {
    load();
  }, []);

  async function recompute() {
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await fetch('/api/dev/ai-learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recompute' }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? 'No se pudo recalcular');
    setNote(`Recalculado: ${json.recomputed} preguntas con intentos de estudiantes reales (la clase [CARGA] se excluye).`);
    setState(json);
  }

  const row = (label: string, value: string | number) => (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
      <span className="text-sm text-slate-300">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-300">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {!state && !error && <Loader2 className="w-5 h-5 animate-spin text-slate-400" />}
      {state && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          {row('Señales registradas (juez + profesor)', state.feedbackEvents.total)}
          {row('· del juez IA', state.feedbackEvents.judge)}
          {row('· del profesor', state.feedbackEvents.teacher)}
          {row('Preguntas con estadísticas', state.questionStats.rows)}
          {row('Última vez recalculadas', state.questionStats.lastComputedAt ? new Date(state.questionStats.lastComputedAt).toLocaleString('es') : 'Nunca')}
          {row('Cuadernos de estilo activos', state.activePlaybooks)}
          {row('Ciclos cerrados', state.closedCycles)}
        </div>
      )}
      <div className="space-y-2">
        <button type="button" onClick={recompute} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500/80 text-white text-sm font-medium disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Recalcular estadísticas por pregunta
        </button>
        <p className="text-xs text-slate-400">Recalcula desde cero aciertos, intentos y estudiantes distintos por pregunta. Es seguro repetirlo. Con menos de 5 intentos por pregunta la tasa es ruido.</p>
        {note && <p className="text-sm text-emerald-300">{note}</p>}
      </div>
    </div>
  );
}
