'use client';

import { useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { deleteResearchRoute, generateResearchRoute } from '@/lib/actions/research';

interface Source {
  n: number;
  title: string;
  url: string | null;
  reach: 'ok' | 'broken' | 'unchecked';
}
interface Route {
  id: string;
  topic: string;
  answer: string;
  sources: Source[];
  cited_ratio: number;
  model: string;
  created_at: string;
}

const REACH_LABEL = { ok: 'responde', broken: 'enlace roto', unchecked: 'no se pudo comprobar' } as const;

export default function ResearchClient({ classroomId, routes }: { classroomId: string; routes: Route[] }) {
  const [topic, setTopic] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  const generate = () =>
    start(async () => {
      setMsg(null);
      const r = await generateResearchRoute(classroomId, topic);
      if (r.ok) {
        setTopic('');
        setMsg({ ok: true, text: 'Ruta lista. Revísala abajo.' });
      } else setMsg({ ok: false, text: r.error ?? 'No se pudo generar la ruta.' });
    });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line shadow-card bg-surface p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <Search className="w-5 h-5 text-accent-text" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-fg">Ruta de investigación</h2>
          <p className="text-sm text-fg-muted mt-0.5">
            La IA busca en la web y te propone lecturas, preguntas guía y un estilo de pregunta para un tema. Son <strong>sugerencias para ti</strong>: no son material del curso y los estudiantes no las ven. Cada
            afirmación lleva una marca [n] a su fuente; lo que no la lleva no está respaldado. Verifica las fuentes antes de usarlas.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 space-y-3">
        <label htmlFor="research-topic" className="text-sm font-medium text-fg">
          Tema a investigar
        </label>
        <input id="research-topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} placeholder="Por ejemplo: elasticidad precio de la demanda" className="w-full rounded-xl border border-line bg-bg p-3 text-sm text-fg" />
        <button type="button" disabled={busy || topic.trim().length < 3} onClick={generate} className="px-4 py-2 rounded-xl bg-accent text-on-accent text-sm font-medium disabled:opacity-50">
          {busy ? 'Buscando… (puede tardar hasta un minuto)' : 'Generar ruta'}
        </button>
        <p className="text-xs text-fg-muted">Máximo 5 rutas por clase al día.</p>
        {msg && (
          <p role="status" className={`text-sm ${msg.ok ? 'text-fg-muted' : 'text-danger'}`}>
            {msg.text}
          </p>
        )}
      </div>

      {routes.length === 0 && <p className="text-sm text-fg-muted">Aún no hay rutas.</p>}
      {routes.map((r) => (
        <section key={r.id} className="rounded-2xl border border-line bg-surface p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-fg">{r.topic}</h3>
              <p className="text-xs text-fg-muted">
                {new Date(r.created_at).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })} · {r.model} · {Math.round(r.cited_ratio * 100)} % del texto con fuente
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => start(async () => void (await deleteResearchRoute(classroomId, r.id)))}
              className="px-3 py-1.5 rounded-lg border border-line text-xs text-danger disabled:opacity-50"
            >
              Eliminar
            </button>
          </div>
          {r.cited_ratio < 0.3 && <p className="text-xs text-warning">Poco del texto está respaldado por fuentes: trátalo como una pista, no como un dato.</p>}
          <p className="text-sm text-fg whitespace-pre-wrap">{r.answer}</p>
          <div>
            <h4 className="text-sm font-semibold text-fg mb-1">Fuentes</h4>
            <ol className="space-y-1">
              {r.sources.map((s) => (
                <li key={s.n} className="text-sm text-fg">
                  [{s.n}]{' '}
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-text underline break-all">
                      {s.title || s.url}
                    </a>
                  ) : (
                    <span>{s.title || 'Fuente sin enlace'}</span>
                  )}{' '}
                  <span className="text-xs text-fg-muted">· {REACH_LABEL[s.reach]}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ))}
    </div>
  );
}
