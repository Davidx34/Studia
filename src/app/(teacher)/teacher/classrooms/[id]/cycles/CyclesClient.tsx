'use client';

import { useState, useTransition } from 'react';
import { History } from 'lucide-react';
import { closeCycle, setSuggestionStatus } from '@/lib/actions/cycles';

type Status = 'pending' | 'accepted' | 'rejected' | 'postponed';
interface Finding {
  id: string;
  text: string;
  evidence: string;
  conclusive: boolean;
}
interface Suggestion {
  id: string;
  text: string;
  evidence: string;
  status: Status;
}
interface Cycle {
  id: string;
  label: string;
  period_start: string;
  period_end: string;
  snapshot: { students: number; finishedLessons: number; questionAttempts: number; truncated?: boolean };
  retro: { id: string; findings: Finding[]; suggestions: Suggestion[] } | null;
}

const STATUS_LABEL: Record<Status, string> = { pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada', postponed: 'Pospuesta' };
const ACTION_LABEL = { accepted: 'Aceptar', rejected: 'Rechazar', postponed: 'Posponer' } as const;
const fmt = (d: string) => new Date(d).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

export default function CyclesClient({ classroomId, cycles }: { classroomId: string; cycles: Cycle[] }) {
  const [label, setLabel] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'No se pudo completar.' });
      if (r.ok) setConfirming(false);
    });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line shadow-card bg-surface p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <History className="w-5 h-5 text-accent-text" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-fg">Ciclos y retrospectiva</h2>
          <p className="text-sm text-fg-muted mt-0.5">
            Al cerrar un ciclo (por ejemplo 2027-I) se guarda una foto de cómo fue: rendimiento por módulo y concepto, preguntas muy difíciles o muy fáciles, y el estado de la revisión. Se genera una
            retrospectiva con hallazgos que citan su dato y sugerencias que tú aceptas, rechazas o pospones. Con pocos datos, la retrospectiva lo dice y no concluye. Las respuestas de los estudiantes
            no se borran ni se modifican.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 space-y-3">
        <label htmlFor="cycle-label" className="text-sm font-medium text-fg">
          Nombre del ciclo que vas a cerrar
        </label>
        <input id="cycle-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="2027-I" className="w-full rounded-xl border border-line bg-bg p-3 text-sm text-fg" />
        {!confirming ? (
          <button type="button" disabled={busy || !label.trim()} onClick={() => setConfirming(true)} className="px-4 py-2 rounded-xl bg-accent text-on-accent text-sm font-medium disabled:opacity-50">
            Cerrar ciclo y generar retrospectiva
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-fg-muted">Esto registra el cierre de «{label.trim()}» y no se puede deshacer. ¿Continuar?</span>
            <button type="button" disabled={busy} onClick={() => run(() => closeCycle(classroomId, label), 'Ciclo cerrado. La retrospectiva está abajo.')} className="px-4 py-2 rounded-xl bg-accent text-on-accent text-sm font-medium disabled:opacity-50">
              {busy ? 'Generando…' : 'Sí, cerrar'}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="px-4 py-2 rounded-xl border border-line text-sm text-fg">
              Cancelar
            </button>
          </div>
        )}
        {msg && (
          <p role="status" className={`text-sm ${msg.ok ? 'text-fg-muted' : 'text-danger'}`}>
            {msg.text}
          </p>
        )}
      </div>

      {cycles.length === 0 && <p className="text-sm text-fg-muted">Aún no hay ciclos cerrados.</p>}
      {cycles.map((c) => (
        <section key={c.id} className="rounded-2xl border border-line bg-surface p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-fg">{c.label}</h3>
            <p className="text-xs text-fg-muted">
              {fmt(c.period_start)} – {fmt(c.period_end)} · {c.snapshot.students} estudiantes · {c.snapshot.finishedLessons} lecciones terminadas · {c.snapshot.questionAttempts} respuestas
              {c.snapshot.truncated && ' · datos truncados por volumen'}
            </p>
          </div>
          {c.retro && (
            <>
              <div>
                <h4 className="text-sm font-semibold text-fg mb-1">Hallazgos</h4>
                <ul className="space-y-1.5">
                  {c.retro.findings.map((f) => (
                    <li key={f.id} className="text-sm text-fg">
                      {f.text} <span className="text-fg-muted">— {f.evidence}</span>
                      {!f.conclusive && <span className="text-fg-muted"> (sin datos suficientes para concluir)</span>}
                    </li>
                  ))}
                </ul>
              </div>
              {c.retro.suggestions.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-fg mb-1">Sugerencias</h4>
                  <ul className="space-y-2">
                    {c.retro.suggestions.map((s) => (
                      <li key={s.id} className="rounded-xl border border-line p-3">
                        <p className="text-sm text-fg">{s.text}</p>
                        <p className="text-xs text-fg-muted mt-0.5">Basado en: {s.evidence}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-fg-muted">{STATUS_LABEL[s.status]}</span>
                          {(['accepted', 'rejected', 'postponed'] as const)
                            .filter((st) => st !== s.status)
                            .map((st) => (
                              <button
                                key={st}
                                type="button"
                                disabled={busy}
                                onClick={() => run(() => setSuggestionStatus(classroomId, c.retro!.id, s.id, st), `Sugerencia ${STATUS_LABEL[st].toLowerCase()}.`)}
                                className="px-2.5 py-1 rounded-lg border border-line text-xs text-fg disabled:opacity-50"
                              >
                                {ACTION_LABEL[st]}
                              </button>
                            ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
