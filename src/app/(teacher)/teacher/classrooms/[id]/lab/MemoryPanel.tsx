'use client';

// Memoria de la clase: lo que la IA sabe de la materia segun los materiales cargados. El profesor la construye (o actualiza), ve cuanto se ha leido y puede explorar lo que
// la IA entendio, por temas (con sus partes) o por tipo. Si falta leer materiales, la lectura continua sola hasta completarse.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Loader2, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { buildTree, countParts, groupConcepts, headline, isStale, progress, shouldContinue, type MemorySummary, type TreeNode } from '@/lib/memory/panelState';
import { KIND_LABEL, type Concept, type Edge } from '@/lib/memory/types';

const POLL_MS = 4000;
const NEXT_RUN_MS = 1500;

const TONE: Record<string, string> = {
  neutral: 'text-fg-muted',
  ok: 'text-success',
  warn: 'text-fg',
  danger: 'text-danger',
};

function Dots({ n }: { n: number }) {
  return (
    <span className="font-normal text-fg-muted" title={`Importancia ${n} de 5`} aria-label={`Importancia ${n} de 5`}>
      {'●'.repeat(n)}
    </span>
  );
}

function ConceptCard({ c }: { c: Concept }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-2.5 text-sm">
      <p className="font-semibold text-fg [overflow-wrap:anywhere]">
        {c.name} <span className="font-normal text-fg-muted">· {KIND_LABEL[c.kind]}</span> <Dots n={c.importance} />
      </p>
      {c.definition && <p className="text-fg-muted [overflow-wrap:anywhere]">{c.definition}</p>}
      {c.formula && <p className="mt-0.5 font-mono text-xs text-fg [overflow-wrap:anywhere]">{c.formula}</p>}
    </li>
  );
}

// Un tema con sus partes, en varios niveles (cada nivel se abre aparte).
function Branch({ n, depth }: { n: TreeNode; depth: number }) {
  const parts = countParts(n);
  return (
    <li className="rounded-lg border border-line bg-surface p-2.5 text-sm">
      <p className={`text-fg [overflow-wrap:anywhere] ${depth === 0 ? 'font-bold' : 'font-semibold'}`}>
        {n.concept.name} <span className="font-normal text-fg-muted">· {KIND_LABEL[n.concept.kind]}</span> <Dots n={n.concept.importance} />
      </p>
      {n.concept.definition && <p className="text-fg-muted [overflow-wrap:anywhere]">{n.concept.definition}</p>}
      {n.concept.formula && <p className="mt-0.5 font-mono text-xs text-fg [overflow-wrap:anywhere]">{n.concept.formula}</p>}
      {n.children.length > 0 && (
        <details className="mt-2">
          <summary className="min-h-[32px] cursor-pointer text-xs font-semibold text-primary-text">
            {parts} {parts === 1 ? 'parte' : 'partes'}
          </summary>
          <ul className="mt-2 space-y-1.5 border-l-2 border-line pl-3">
            {n.children.map((k) => (
              <Branch key={k.concept.key} n={k} depth={depth + 1} />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export default function MemoryPanel({ classroomId, initial, materialCount, tableMissing }: { classroomId: string; initial: MemorySummary; materialCount: number; tableMissing: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [summary, setSummary] = useState<MemorySummary>(initial);
  const [graph, setGraph] = useState<{ concepts: Concept[]; edges: Edge[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'temas' | 'tipo'>('temas');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [requestError, setRequestError] = useState<string | null>(null);
  // Cadena de pasadas iniciada por el profesor: continua mientras falte leer y cada pasada avance.
  const [auto, setAuto] = useState(false);
  const runs = useRef(0);
  const lastDone = useRef(-1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const db: any = supabase;

  const refresh = useCallback(async () => {
    const { data } = await db.from('class_memory').select('status, version, built_at, started_at, error, stats').eq('classroom_id', classroomId).maybeSingle();
    if (!data) return;
    setNow(Date.now());
    setSummary({ status: data.status, version: data.version, builtAt: data.built_at, startedAt: data.started_at, error: data.error, stats: data.stats });
  }, [db, classroomId]);

  const loadGraph = useCallback(async () => {
    const { data } = await db.from('class_memory').select('graph').eq('classroom_id', classroomId).maybeSingle();
    setGraph({ concepts: Array.isArray(data?.graph?.concepts) ? data.graph.concepts : [], edges: Array.isArray(data?.graph?.edges) ? data.graph.edges : [] });
  }, [db, classroomId]);

  const start = useCallback(
    async (force: boolean) => {
      setBusy(true);
      setRequestError(null);
      try {
        const res = await fetch('/api/memory/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroomId, force }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.status === 'failed') {
          setRequestError(typeof data?.error === 'string' ? data.error : 'No se pudo iniciar. Inténtalo de nuevo.');
          setAuto(false);
          return;
        }
        setNow(Date.now());
        setSummary((s) => ({ ...s, status: 'building', startedAt: new Date().toISOString(), error: null }));
      } catch {
        setRequestError('No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.');
        setAuto(false);
      } finally {
        setBusy(false);
      }
    },
    [classroomId]
  );

  // Mientras se construye, se consulta cada pocos segundos.
  useEffect(() => {
    if (summary.status !== 'building' || isStale(summary, now)) return;
    timer.current = setInterval(refresh, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [summary, now, refresh]);

  // Al terminar una pasada: si falta leer y avanzo, se pide la siguiente (solo en una cadena iniciada por el profesor).
  useEffect(() => {
    if (!auto || summary.status !== 'ready') return;
    if (shouldContinue(lastDone.current, summary, runs.current)) {
      lastDone.current = summary.stats?.groupsDone ?? 0;
      runs.current += 1;
      const t = setTimeout(() => start(false), NEXT_RUN_MS);
      return () => clearTimeout(t);
    }
    setAuto(false);
  }, [auto, summary, start]);

  useEffect(() => {
    if (summary.status === 'ready' && open) loadGraph();
  }, [summary.version, summary.status, open, loadGraph]);

  const click = (force: boolean) => {
    runs.current = 0;
    lastDone.current = force ? -1 : (summary.stats?.groupsDone ?? -1);
    setAuto(true);
    start(force);
  };

  const tree = useMemo(() => (graph ? buildTree(graph.concepts, graph.edges) : null), [graph]);

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
  const working = building || busy || (auto && !!summary.stats?.incomplete);
  const p = progress(summary);
  const groups = graph ? groupConcepts(graph.concepts) : [];

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h3 className="flex items-center gap-2 text-base font-bold text-fg">
          <Brain aria-hidden="true" className="h-5 w-5" /> Memoria de la clase
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          La IA lee tus materiales y arma un mapa de lo que se enseña: los temas, sus partes y cómo se conectan (y, en materias numéricas, las variables y fórmulas). Así los laboratorios se adaptan a tu materia y, si lo que cargaste no alcanza para crear algo, te dice qué falta en vez de inventarlo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => click(false)} loading={working} disabled={working || materialCount === 0}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" /> {summary.status === 'none' ? 'Construir memoria' : summary.stats?.incomplete ? 'Continuar leyendo' : 'Actualizar memoria'}
        </Button>
        {summary.status === 'ready' && !working && (
          <Button variant="ghost" onClick={() => click(true)}>
            Releer todo
          </Button>
        )}
        <p role="status" aria-live="polite" className={`text-sm ${requestError ? 'text-danger' : TONE[h.tone]}`}>
          {working && <Loader2 aria-hidden="true" className="mr-1 inline h-4 w-4 animate-spin motion-reduce:animate-none" />}
          {requestError ?? (materialCount === 0 && summary.status === 'none' ? 'Primero sube y procesa al menos un material.' : h.text)}
        </p>
      </div>

      {p && p.groupsTotal > 0 && (summary.stats?.incomplete || working) && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} aria-label="Lectura de los materiales">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${p.percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {p.read} de {p.total} {p.total === 1 ? 'material leído' : 'materiales leídos'} · {p.groupsDone} de {p.groupsTotal} bloques
          </p>
        </div>
      )}

      {summary.status === 'ready' && (summary.stats?.concepts ?? 0) > 0 && (
        <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="rounded-xl border border-line bg-surface-2">
          <summary className="min-h-[44px] cursor-pointer list-none px-4 py-3 text-sm font-semibold text-fg">
            Ver lo que la IA sabe ({summary.stats?.concepts} conceptos, {summary.stats?.edges ?? 0} conexiones)
          </summary>
          <div className="space-y-4 border-t border-line p-4">
            <div className="flex gap-2" role="group" aria-label="Cómo ver los conceptos">
              {(['temas', 'tipo'] as const).map((v) => (
                <Button key={v} size="sm" variant={view === v ? 'primary' : 'secondary'} aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === 'temas' ? 'Por temas' : 'Por tipo'}
                </Button>
              ))}
            </div>
            {graph === null && <p className="text-sm text-fg-muted">Cargando…</p>}

            {view === 'temas' && tree && (
              <div className="space-y-3">
                <ul className="space-y-3">
                  {tree.roots.map((n) => (
                    <Branch key={n.concept.key} n={n} depth={0} />
                  ))}
                </ul>
                {tree.minor.length > 0 && (
                  <details className="rounded-xl border border-line bg-surface p-3">
                    <summary className="min-h-[32px] cursor-pointer text-sm font-semibold text-fg">Detalles menores ({tree.minor.length})</summary>
                    <ul className="mt-2 space-y-1.5">
                      {tree.minor.map((c) => (
                        <ConceptCard key={c.key} c={c} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {view === 'tipo' &&
              groups.map((g) => (
                <section key={g.kind}>
                  <h4 className="mb-1 text-sm font-bold text-fg">
                    {KIND_LABEL[g.kind]} <span className="font-normal text-fg-muted">({g.items.length})</span>
                  </h4>
                  <ul className="space-y-1.5">
                    {g.items.map((c) => (
                      <ConceptCard key={c.key} c={c} />
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
