'use client';

import { useState, useTransition } from 'react';
import { BarChart3 } from 'lucide-react';
import { rejectReviewQuestion } from '@/lib/actions/learning-objectives';

export interface FlaggedQuestion {
  questionId: string;
  kind: 'muy_dificil' | 'muy_facil';
  attempts: number;
  rate: number;
  students: number;
  reason: string;
  type: string;
  q: string;
  moduleTitle: string;
}

// Flecha «estadisticas de estudiantes -> banderas»: solo SENALA; retirar una pregunta es decision del profesor. Retirarla queda registrado como decision tuya (sirve para calibrar al juez).
export default function FlaggedCard({ classroomId, flagged, summary }: { classroomId: string; flagged: FlaggedQuestion[]; summary: { total: number; belowMinimum: number } }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const visible = flagged.filter((f) => !gone.has(f.questionId));

  const retire = (id: string) =>
    start(async () => {
      setError(null);
      const r = await rejectReviewQuestion(id, classroomId);
      if (!r.ok) return setError(r.error ?? 'No se pudo retirar la pregunta.');
      setGone((prev) => new Set(prev).add(id));
    });

  return (
    <div className="rounded-2xl border border-line shadow-card bg-surface p-5 space-y-3" data-testid="flagged-questions">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <BarChart3 className="w-5 h-5 text-accent-text" aria-hidden />
        </div>
        <div>
          <h2 className="text-base font-semibold text-fg">Preguntas que señalan tus estudiantes</h2>
          <p className="text-sm text-fg-muted mt-0.5">
            {visible.length === 0
              ? `Ninguna pregunta tiene señales claras todavía. ${summary.belowMinimum} de ${summary.total} preguntas con respuestas aún tienen menos de 10 respuestas, y con tan pocas no se puede concluir nada.`
              : 'Preguntas con suficientes respuestas (10 o más) que casi nadie acierta o que casi todos aciertan. La IA solo las señala: tú decides si retirarlas.'}
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {visible.map((f) => (
          <li key={f.questionId} className="rounded-xl border border-line p-3">
            <p className="text-xs text-fg-muted">
              {f.moduleTitle} · {f.type}
            </p>
            <p className="text-sm text-fg mt-0.5">{f.q}</p>
            <p className="text-xs text-fg-muted mt-1">{f.reason}</p>
            <button type="button" disabled={busy} onClick={() => retire(f.questionId)} className="mt-2 px-3 py-1.5 rounded-lg border border-line text-xs text-danger disabled:opacity-50">
              Retirar la pregunta
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
