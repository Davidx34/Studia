'use client';

// Memoria de la clase: lo que la IA sabe de la materia segun los materiales cargados. El profesor la construye (o actualiza) y puede ver los conceptos que encontro.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Loader2, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { groupConcepts, headline, isStale, type MemorySummary } from '@/lib/memory/panelState';
import { KIND_LABEL, type Concept } from '@/lib/memory/types';

const POLL_MS = 4000;

const TONE: Record<string, string> = {
  neutral: 'text-fg-muted',
  ok: 'text-success',
  warn: 'text-fg',
  danger: 'text-danger',
};

export default function MemoryPanel({ classroomId, initial, materialCount, tableMissing }: { classroomId: string; initial: MemorySummary; materialCount: number; tableMissing: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [summary, setSummary] = useState<MemorySummary>(initial);
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [requestError, setRequestError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const db: any = supabase;

  const refresh = useCallback(async () => {
    const { data } = await db.from('class_memory').select('status, version, built_at, started_at, error, stats').eq('classroom_id', classroomId).maybeSingle();
    if (!data) return;
    setNow(Date.now());
    setSummary({ status: data.status, version: data.version, builtAt: data.built_at, startedAt: data.started_at, error: data.error, stats: data.stats });
  }, [db, classroomId]);

  const loadConcepts = useCallback(async () => {
    const { data } = await db.from('class_memory').select('graph').eq('classroom_id', classroomId).maybeSingle();
    setConcepts(Array.isArray(data?.graph?.concepts) ? (data.graph.concepts as Concept[]) : []);
  }, [db, classroomId]);

  // Mientras se construye, se consulta cada pocos segundos; al terminar se recarga la lista.
  useEffect(() => {
    if (summary.status !== 'building' || isStale(summary, now)) return;
    timer.current = setInterval(refresh, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [summary, now, refresh]);

  useEffect(() => {
    if (summary.status === 'ready' && open) loadConcepts();
  }, [summary.version, summary.status, open, loadConcepts]);

  const build = async (force: boolean) => {
    setBusy(true);
    setRequestError(null);
    try {
      const res = await fetch('/api/memory/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroomId, force }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status === 'failed') {
        setRequestError(typeof data?.error === 'string' ? data.error : 'No se pudo iniciar. Inténtalo de nuevo.');
        return;
      }
      setNow(Date.now());
      setSummary((s) => ({ ...s, status: 'building', startedAt: new Date().toISOString(), error: null }));
    } catch {
      setRequestError('No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  if (tableMissing) {
    return (
      <Card className="space-y-2 p-5">
        <h3 className="flex items-center gap-2 font-bold text-fg">
          <Brain aria-hidden="true" className="h-5 w-5" /> Memoria de la clase
        </h3>
        <p className="text-sm text-fg-muted">Esta función todavía no está activada en la base de datos (falta aplicar la migración 079).</p>
      </Card>
    );
  }

  const h = headline(summary, now);
  const building = summary.status === 'building' && !isStale(summary, now);
  const groups = concepts ? groupConcepts(concepts) : [];

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h3 className="flex items-center gap-2 text-base font-bold text-fg">
          <Brain aria-hidden="true" className="h-5 w-5" /> Memoria de la clase
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          La IA lee tus materiales y arma un mapa de lo que se enseña: conceptos, variables, fórmulas y cómo se conectan. Así los laboratorios se adaptan a tu materia y, si lo que cargaste no alcanza para crear algo, te dice qué falta en vez de inventarlo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => build(false)} loading={busy || building} disabled={busy || building || materialCount === 0}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" /> {summary.status === 'none' ? 'Construir memoria' : 'Actualizar memoria'}
        </Button>
        {summary.status === 'ready' && (
          <Button variant="ghost" onClick={() => build(true)} disabled={busy || building}>
            Releer todo
          </Button>
        )}
        <p role="status" aria-live="polite" className={`text-sm ${requestError ? 'text-danger' : TONE[h.tone]}`}>
          {building && <Loader2 aria-hidden="true" className="mr-1 inline h-4 w-4 animate-spin motion-reduce:animate-none" />}
          {requestError ?? (materialCount === 0 && summary.status === 'none' ? 'Primero sube y procesa al menos un material.' : h.text)}
        </p>
      </div>

      {summary.status === 'ready' && (summary.stats?.concepts ?? 0) > 0 && (
        <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="rounded-xl border border-line bg-surface-2">
          <summary className="min-h-[44px] cursor-pointer list-none px-4 py-3 text-sm font-semibold text-fg">
            Ver lo que la IA sabe ({summary.stats?.concepts} conceptos, {summary.stats?.edges ?? 0} conexiones)
          </summary>
          <div className="space-y-4 border-t border-line p-4">
            {concepts === null && <p className="text-sm text-fg-muted">Cargando…</p>}
            {groups.map((g) => (
              <section key={g.kind}>
                <h4 className="mb-1 text-sm font-bold text-fg">
                  {KIND_LABEL[g.kind]} <span className="font-normal text-fg-muted">({g.items.length})</span>
                </h4>
                <ul className="space-y-1.5">
                  {g.items.map((c) => (
                    <li key={c.key} className="rounded-lg border border-line bg-surface p-2.5 text-sm">
                      <p className="font-semibold text-fg [overflow-wrap:anywhere]">
                        {c.name} <span className="font-normal text-fg-muted" title={`Importancia ${c.importance} de 5`}>{'●'.repeat(c.importance)}</span>
                      </p>
                      {c.definition && <p className="text-fg-muted [overflow-wrap:anywhere]">{c.definition}</p>}
                      {c.formula && <p className="mt-0.5 font-mono text-xs text-fg [overflow-wrap:anywhere]">{c.formula}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
