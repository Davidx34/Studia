'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LabFrame } from '@/components/lab/LabFrame';
import { REVIEW_LIMITS } from '@/lib/lab/reviewLimits';
import type { LabAttemptState, ResolvedLab } from '@/lib/lab/types';

export interface AttemptView {
  id: string;
  studentName: string;
  createdAt: string;
  status: 'submitted' | 'reviewed';
  score: number | null;
  feedback: string;
  state: LabAttemptState | null;
}

const inputCls =
  'w-full min-h-[44px] rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-base text-fg placeholder:text-fg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function AttemptsReview({ lab, attempts }: { lab: ResolvedLab; attempts: AttemptView[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(attempts[0]?.id ?? null);
  const selected = attempts.find((a) => a.id === selectedId) ?? null;
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const select = (a: AttemptView) => {
    setSelectedId(a.id);
    setScore(a.score === null ? '' : String(a.score));
    setFeedback(a.feedback);
    setMessage(null);
  };

  // Al abrir la pagina, el primero queda seleccionado con sus valores.
  const [initialized, setInitialized] = useState(false);
  if (!initialized && attempts[0]) {
    setInitialized(true);
    setScore(attempts[0].score === null ? '' : String(attempts[0].score));
    setFeedback(attempts[0].feedback);
  }

  async function save() {
    if (!selected || saving) return;
    const n = Number(score);
    if (score.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      setMessage({ ok: false, text: 'La nota debe ser un número de 0 a 100.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/lab/attempt/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId: selected.id, score: n, feedback }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ ok: false, text: data?.error ?? 'No se pudo guardar la revisión.' });
      else {
        setMessage({ ok: true, text: 'Revisión guardada. El estudiante ya la ve.' });
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: 'No se pudo conectar. Inténtalo de nuevo.' });
    } finally {
      setSaving(false);
    }
  }

  if (attempts.length === 0) return <Card className="p-4 text-fg-muted">Todavía nadie entregó este laboratorio.</Card>;

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <ul className="space-y-2" aria-label="Estudiantes que entregaron">
        {attempts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => select(a)}
              aria-current={a.id === selectedId ? 'true' : undefined}
              className={`w-full rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${a.id === selectedId ? 'border-primary bg-primary/10' : 'border-line bg-surface hover:border-line-strong'}`}
            >
              <span className="block font-semibold text-fg [overflow-wrap:anywhere]">{a.studentName}</span>
              <span className="block text-xs text-fg-muted">{fmtDate(a.createdAt)}</span>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${a.status === 'reviewed' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
                {a.status === 'reviewed' ? `Revisado · ${a.score}/100` : 'Por revisar'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3 p-4">
            <h3 className="font-bold text-fg">Revisión de {selected.studentName}</h3>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-fg-muted">Nota (0 a 100)</span>
              <input className={inputCls} type="number" inputMode="decimal" min={0} max={100} step="0.5" value={score} onChange={(e) => setScore(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-fg-muted">Comentario para el estudiante (opcional)</span>
              <textarea className={`${inputCls} min-h-[96px]`} maxLength={REVIEW_LIMITS.feedbackMax} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} loading={saving} disabled={saving}>
                {selected.status === 'reviewed' ? 'Actualizar revisión' : 'Guardar revisión'}
              </Button>
              {message && (
                <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-success' : 'text-danger'}`}>
                  {message.text}
                </p>
              )}
            </div>
          </Card>
          {/* El informe tal como lo entrego el estudiante, en solo lectura. key: al cambiar de estudiante se monta de nuevo (el estado inicial se manda una sola vez). */}
          {selected.state && <LabFrame key={selected.id} lab={lab} state={selected.state} readOnly />}
        </div>
      )}
    </div>
  );
}
