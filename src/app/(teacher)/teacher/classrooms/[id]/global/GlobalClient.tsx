'use client';

import { useState, useTransition } from 'react';
import { Globe } from 'lucide-react';
import { saveBenchmarkProfile } from '@/lib/actions/benchmark';
import { AGE_BANDS, CONSENT_TEXT, LEVELS, SUBJECTS, typeLabel, type BenchmarkRow } from '@/lib/aiLearning/benchmark';

interface ProfileState {
  subject: string;
  level: string;
  ageBand: string;
  share: boolean;
  optedInAt: string | null;
}

const selectCls = 'w-full rounded-xl border border-line bg-bg p-3 text-sm text-fg';

export default function GlobalClient({ classroomId, profile, rows }: { classroomId: string; profile: ProfileState | null; rows: BenchmarkRow[] }) {
  const [subject, setSubject] = useState(profile?.subject ?? '');
  const [level, setLevel] = useState(profile?.level ?? '');
  const [ageBand, setAgeBand] = useState(profile?.ageBand ?? '');
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const sharing = profile?.share === true;
  const complete = subject && level && ageBand;

  const save = (share: boolean, okText: string) =>
    start(async () => {
      const r = await saveBenchmarkProfile(classroomId, { subject, level, ageBand, share });
      setMsg(r.ok ? { ok: !r.error, text: r.error ?? okText } : { ok: false, text: r.error ?? 'No se pudo guardar.' });
      if (r.ok) setAgree(false);
    });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line shadow-card bg-surface p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <Globe className="w-5 h-5 text-accent-text" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-fg">Memoria global anónima</h2>
          <p className="text-sm text-fg-muted mt-0.5">
            Si quieres, esta clase aporta estadísticas agregadas y anónimas para que todos los profesores tengan una referencia de cuánto suelen acertar los estudiantes en cada tipo de pregunta. Es opcional, está
            apagado por defecto y puedes revocarlo cuando quieras. La referencia nunca reemplaza los datos de tu propia clase.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 space-y-3">
        <h3 className="text-sm font-semibold text-fg">Tipo de clase</h3>
        <p className="text-xs text-fg-muted">Listas cerradas, para que clases parecidas se agrupen bien.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-fg space-y-1">
            Materia
            <select value={subject} onChange={(e) => setSubject(e.target.value)} className={selectCls}>
              <option value="">Elige…</option>
              {Object.entries(SUBJECTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-fg space-y-1">
            Nivel
            <select value={level} onChange={(e) => setLevel(e.target.value)} className={selectCls}>
              <option value="">Elige…</option>
              {Object.entries(LEVELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-fg space-y-1">
            Edad de los estudiantes
            <select value={ageBand} onChange={(e) => setAgeBand(e.target.value)} className={selectCls}>
              <option value="">Elige…</option>
              {Object.entries(AGE_BANDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!sharing ? (
          <div className="space-y-3 pt-2">
            <label className="flex items-start gap-2 text-sm text-fg">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
              <span>{CONSENT_TEXT}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !complete || !agree} onClick={() => save(true, 'Listo: esta clase ya aporta de forma anónima.')} className="px-4 py-2 rounded-xl bg-accent text-on-accent text-sm font-medium disabled:opacity-50">
                {busy ? 'Guardando…' : 'Aportar a la memoria global'}
              </button>
              <button type="button" disabled={busy || !complete} onClick={() => save(false, 'Tipo de clase guardado (sin compartir).')} className="px-4 py-2 rounded-xl border border-line text-sm text-fg disabled:opacity-50">
                Guardar sin compartir
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            <p className="text-sm text-fg-muted">
              Esta clase aporta desde {profile?.optedInAt ? new Date(profile.optedInAt).toLocaleDateString('es') : 'hace poco'}. Si cambias materia, nivel o edad, se vuelve a registrar tu autorización.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !complete} onClick={() => save(true, 'Tipo de clase actualizado.')} className="px-4 py-2 rounded-xl border border-line text-sm text-fg disabled:opacity-50">
                Actualizar tipo de clase
              </button>
              <button type="button" disabled={busy} onClick={() => save(false, 'Revocado: esta clase dejó de aportar.')} className="px-4 py-2 rounded-xl border border-line text-sm text-danger disabled:opacity-50">
                Dejar de aportar
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p role="status" className={`text-sm ${msg.ok ? 'text-fg-muted' : 'text-danger'}`}>
            {msg.text}
          </p>
        )}
      </div>

      {sharing && (
        <div className="rounded-2xl border border-line bg-surface p-5 space-y-2" data-testid="global-reference">
          <h3 className="text-sm font-semibold text-fg">Referencia para clases como la tuya</h3>
          {rows.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Todavía no hay suficientes clases aportando en este tipo de clase. Para proteger el anonimato, un dato solo aparece cuando lo aportan al menos 5 clases de 3 profesores distintos y 50 intentos.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li key={r.question_type} className="text-sm text-fg">
                  {typeLabel(r.question_type)}: <strong>{Math.round(r.correct_rate * 100)} %</strong> de acierto <span className="text-fg-muted">({r.n_classes} clases, {r.n_teachers} profesores, {r.attempts} intentos)</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-fg-muted">Es un valor de referencia, no una meta: tu clase manda.</p>
        </div>
      )}
    </div>
  );
}
