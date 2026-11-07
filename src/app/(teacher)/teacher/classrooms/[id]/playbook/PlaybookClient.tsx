'use client';

import { useState, useTransition } from 'react';
import { BookMarked } from 'lucide-react';
import { savePlaybookDraft, activatePlaybook, deactivatePlaybook, importPlaybook } from '@/lib/actions/playbook';

interface Version {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'retired';
  origin: 'teacher' | 'ai';
  rules: { text: string; evidence?: string }[];
  note: string | null;
  created_at: string;
}

const STATUS_LABEL = { draft: 'Borrador', active: 'Activa', retired: 'Retirada' } as const;

interface Source {
  id: string;
  className: string;
  version: number;
  status: string;
  rules: { text: string }[];
}

export default function PlaybookClient({ classroomId, versions, sources = [] }: { classroomId: string; versions: Version[]; sources?: Source[] }) {
  const active = versions.find((v) => v.status === 'active');
  const [text, setText] = useState((active ?? versions[0])?.rules.map((r) => r.text).join('\n') ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'No se pudo completar.' });
    });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line shadow-card bg-surface p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <BookMarked className="w-5 h-5 text-accent-text" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-fg">Estilo de la IA en esta clase</h2>
          <p className="text-sm text-fg-muted mt-0.5">
            Reglas cortas que la IA leerá al generar preguntas nuevas (una por línea, máximo 10). Ejemplo: «En las preguntas de aplicación, incluye el dato numérico en el enunciado». No
            reemplazan tu material ni la configuración de la clase, y no cambian las preguntas ya generadas. Cada guardado crea una versión nueva; puedes volver a una anterior activándola.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 space-y-3">
        <label htmlFor="playbook-rules" className="text-sm font-medium text-fg">
          Reglas
        </label>
        <textarea
          id="playbook-rules"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-line bg-bg p-3 text-sm text-fg"
          placeholder="Una regla por línea"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => savePlaybookDraft(classroomId, text.split('\n')), 'Guardado como borrador nuevo. Actívalo abajo para que la IA lo use.')}
            className="px-4 py-2 rounded-xl bg-accent text-on-accent text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Guardar como versión nueva'}
          </button>
          {active && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => deactivatePlaybook(classroomId), 'Desactivado: la IA vuelve a generar como antes.')}
              className="px-4 py-2 rounded-xl border border-line text-sm text-fg disabled:opacity-50"
            >
              Desactivar el estilo activo
            </button>
          )}
        </div>
        {msg && (
          <p role="status" className={`text-sm ${msg.ok ? 'text-fg-muted' : 'text-danger'}`}>
            {msg.text}
          </p>
        )}
      </div>

      {sources.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-5 space-y-3">
          <h3 className="text-sm font-semibold text-fg">Traer reglas de otra de tus clases</h3>
          <p className="text-sm text-fg-muted">Se agregan a tus reglas actuales como un borrador nuevo (sin repetir, máximo 10). Tú decides si lo activas. Solo ves clases tuyas.</p>
          <ul className="space-y-2">
            {sources.map((s) => (
              <li key={s.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-fg">
                    {s.className} · versión {s.version}
                    {s.status === 'active' ? ' (activa)' : ''}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      start(async () => {
                        const r = await importPlaybook(classroomId, s.id);
                        setMsg(
                          r.ok
                            ? { ok: true, text: `Se importaron ${r.added} regla(s)${r.skipped ? ` (${r.skipped} ya estaban o no cabían)` : ''}. Revisa el borrador abajo y actívalo si te sirve.` }
                            : { ok: false, text: r.error ?? 'No se pudo importar.' },
                        );
                      })
                    }
                    className="px-3 py-1.5 rounded-lg border border-line text-xs text-fg disabled:opacity-50"
                  >
                    Traer reglas
                  </button>
                </div>
                <ul className="mt-2 list-disc pl-5 text-sm text-fg-muted space-y-0.5">
                  {s.rules.map((r, i) => (
                    <li key={i}>{r.text}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">Versiones</h3>
        {versions.length === 0 && <p className="text-sm text-fg-muted">Aún no hay versiones. Sin estilo activo, la IA genera como siempre.</p>}
        {versions.map((v) => (
          <div key={v.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-fg">
                Versión {v.version} · {STATUS_LABEL[v.status]}
                {v.origin === 'ai' && ' · propuesta de la IA'}
              </p>
              {v.status !== 'active' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => activatePlaybook(classroomId, v.id), `Versión ${v.version} activada.`)}
                  className="px-3 py-1.5 rounded-lg border border-line text-xs text-fg disabled:opacity-50"
                >
                  {v.status === 'retired' ? 'Volver a esta versión' : 'Activar'}
                </button>
              )}
            </div>
            <ul className="mt-2 list-disc pl-5 text-sm text-fg-muted space-y-0.5">
              {v.rules.map((r, i) => (
                <li key={i}>{r.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
