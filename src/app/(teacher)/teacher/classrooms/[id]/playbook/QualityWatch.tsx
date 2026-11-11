'use client';

import { useState, useTransition } from 'react';
import { Activity } from 'lucide-react';
import { activatePlaybook, deactivatePlaybook } from '@/lib/actions/playbook';
import type { MonitorReport, WatchLevel } from '@/lib/aiLearning/regressionMonitor';

const LEVEL_TEXT: Record<WatchLevel, string> = {
  sin_datos: 'Aún no hay preguntas suficientes (se necesitan al menos 30 antes y 30 después) para comparar.',
  estable: 'Sin cambios claros en la calidad. Ojo: «estable» no prueba que el cuaderno ayude, solo que no se nota que empeore.',
  mejora: 'La calidad subió de forma estadísticamente clara tras activarlo.',
  vigilar: 'La calidad parece estar bajando, aunque todavía no es concluyente.',
  regresion: 'La calidad bajó de forma estadísticamente clara.',
};
const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)} %`);

// Monitor de regresion: compara la calidad antes y despues de activar el cuaderno. PROPONE; revertir lo decide el profesor.
export default function QualityWatch({ classroomId, report }: { classroomId: string; report: MonitorReport }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const w = report.watch;
  if (!w && report.alerts.length === 0) return null;

  const revert = (toId: string | null, toVersion: number | null) =>
    start(async () => {
      const r = toId ? await activatePlaybook(classroomId, toId) : await deactivatePlaybook(classroomId);
      setMsg(r.ok ? { ok: true, text: toId ? `Volviste a la versión ${toVersion}. Recarga la página para ver el cambio.` : 'Cuaderno desactivado: la IA vuelve a generar como antes. Recarga la página para ver el cambio.' } : { ok: false, text: r.error ?? 'No se pudo revertir.' });
    });

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 space-y-3" data-testid="quality-watch">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <Activity className="w-5 h-5 text-accent-text" aria-hidden />
        </div>
        <div>
          <h3 className="text-base font-semibold text-fg">Vigilancia de calidad</h3>
          <p className="text-sm text-fg-muted mt-0.5">
            Compara las preguntas generadas antes y después de activar el cuaderno actual. Solo te avisa y propone: volver atrás lo decides tú. Es una comparación entre dos periodos (otros módulos, otro material), no un experimento.
          </p>
        </div>
      </div>

      {w && (
        <p className="text-sm text-fg" data-testid="watch-summary">
          Versión {w.version} activa: {w.before.good} de {w.before.n} buenas antes ({pct(w.comparison.a.rate)}), {w.after.good} de {w.after.n} después ({pct(w.comparison.b.rate)}). <span className="text-fg-muted">{LEVEL_TEXT[w.level]}</span>
        </p>
      )}

      {report.alerts.map((a) => (
        <div key={a.id} role={a.level === 'urgente' ? 'alert' : 'status'} className={`rounded-xl border p-3 ${a.level === 'urgente' ? 'border-danger' : 'border-line'}`}>
          <p className="text-sm font-medium text-fg">{a.title}</p>
          <p className="text-sm text-fg-muted mt-0.5">{a.detail}</p>
          {a.action?.kind === 'revertir_cuaderno' &&
            (() => {
              const { toId, toVersion } = a.action;
              return (
                <button type="button" disabled={busy} onClick={() => revert(toId, toVersion)} className="mt-2 px-3 py-1.5 rounded-lg border border-line text-xs text-fg disabled:opacity-50">
                  {toVersion === null ? 'Desactivar el cuaderno' : `Volver a la versión ${toVersion}`}
                </button>
              );
            })()}
          {a.action?.kind === 'revisar_cola' && (
            <a href={`/teacher/classrooms/${classroomId}/review`} className="inline-block mt-2 px-3 py-1.5 rounded-lg border border-line text-xs text-fg">
              Ir a la revisión
            </a>
          )}
        </div>
      ))}
      {msg && (
        <p role="status" className={`text-sm ${msg.ok ? 'text-fg-muted' : 'text-danger'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
