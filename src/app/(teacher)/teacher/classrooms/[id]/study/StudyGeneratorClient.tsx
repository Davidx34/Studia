'use client';

// Panel del profesor para preparar el material de estudio (fichas de lectura, flashcards, infografias) a partir de los
// materiales ya procesados de su clase. Los estudiantes NO generan nada: solo ven lo que se haya preparado aqui.
//
// Como funciona: el profesor marca materiales y pulsa "Generar". Se arma una cola (un trabajo a la vez, para no
// saturar al proveedor de IA); cada trabajo corre en segundo plano en el servidor y el panel consulta su estado cada
// pocos segundos. Al terminar cada uno avisa si salio bien, si salio incompleto o POR QUE fallo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  RefreshCw,
  Shapes,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card, Badge } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import {
  buildQueue,
  chipState,
  formatElapsed,
  hasStudyContent,
  isActive,
  outcomeNotice,
  pendingIds,
  summarize,
  type ChipState,
  type JobRow,
  type Notice,
  type Task,
} from '@/lib/study/panelState';

export interface MaterialRow {
  id: string;
  name: string;
  sourceType: string;
  chunks: number;
  fichas: number;
  flashcards: number;
  infographics: number;
  cards: JobRow | null;
  ig: JobRow | null;
}

type TaskState = 'waiting' | 'running' | 'done' | 'error';
const POLL_MS = 3000;
const SOURCE_LABEL: Record<string, string> = { file: 'Archivo', link: 'Enlace', notebooklm: 'NotebookLM' };

export default function StudyGeneratorClient({ classroomId, initialRows }: { classroomId: string; initialRows: MaterialRow[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<MaterialRow[]>(initialRows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wantCards, setWantCards] = useState(true);
  const [wantIg, setWantIg] = useState(true);
  const [queue, setQueue] = useState<Task[]>([]);
  const [taskState, setTaskState] = useState<Record<string, TaskState>>({});
  const [running, setRunning] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  // 0 en el primer render (servidor y navegador deben coincidir); se actualiza al montar y cada segundo.
  const [now, setNow] = useState(0);
  const cancelRef = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const noticeId = useRef(0);

  const key = (t: Task) => `${t.materialId}:${t.kind}`;

  const notify = useCallback((n: Omit<Notice, 'id'>) => {
    noticeId.current += 1;
    setNotices((prev) => [{ ...n, id: noticeId.current }, ...prev].slice(0, 30));
  }, []);

  // Estado en vivo desde la base (el profesor puede leer las tablas de sus materiales por RLS).
  const refresh = useCallback(async (): Promise<MaterialRow[]> => {
    const ids = rowsRef.current.map((r) => r.id);
    if (ids.length === 0) return rowsRef.current;
    const db: any = supabase;
    const [cards, gen, ig] = await Promise.all([
      db.from('study_cards').select('material_id, kind').in('material_id', ids),
      db.from('study_card_generation').select('material_id, status, started_at, finished_at, card_count, error').in('material_id', ids),
      db.from('study_infographic_generation').select('material_id, status, started_at, finished_at, card_count, error').in('material_id', ids),
    ]);
    if (cards.error || gen.error || ig.error) return rowsRef.current; // red caida: se conserva lo ultimo visto
    const c = (cards.data ?? []) as { material_id: string; kind: string }[];
    const next = rowsRef.current.map((r) => ({
      ...r,
      fichas: c.filter((x) => x.material_id === r.id && x.kind === 'ficha').length,
      flashcards: c.filter((x) => x.material_id === r.id && x.kind === 'flashcard').length,
      infographics: c.filter((x) => x.material_id === r.id && x.kind === 'infografia').length,
      cards: ((gen.data ?? []) as any[]).find((x) => x.material_id === r.id) ?? null,
      ig: ((ig.data ?? []) as any[]).find((x) => x.material_id === r.id) ?? null,
    }));
    setRows(next);
    rowsRef.current = next;
    return next;
  }, [supabase]);

  const queuedKeys = useMemo(() => new Set(queue.filter((t) => taskState[key(t)] === 'waiting').map(key)), [queue, taskState]);

  const statusOf = useCallback(
    (r: MaterialRow) => ({
      cards: chipState(r.cards, queuedKeys.has(`${r.id}:cards`), now),
      infographics: chipState(r.ig, queuedKeys.has(`${r.id}:infographics`), now),
    }),
    [queuedKeys, now]
  );

  const anyActive = rows.some((r) => {
    const s = statusOf(r);
    return isActive(s.cards.phase) || isActive(s.infographics.phase);
  });

  // Reloj (para el cronometro de lo que esta generandose) y consulta periodica mientras haya algo activo.
  useEffect(() => {
    if (!anyActive) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [anyActive, refresh]);

  useEffect(() => {
    setNow(Date.now());
    void refresh();
  }, [refresh]);

  // Al salir de la pagina se deja de abrir tareas nuevas (la que ya esta en el servidor termina sola).
  useEffect(() => {
    cancelRef.current = false;
    return () => {
      cancelRef.current = true;
    };
  }, []);

  const runTask = useCallback(
    async (t: Task): Promise<void> => {
      setTaskState((p) => ({ ...p, [key(t)]: 'running' }));
      const material = rowsRef.current.find((r) => r.id === t.materialId);
      const name = material?.name ?? 'Material';
      let finalRow: JobRow | null = null;
      try {
        const res = await fetch('/api/study/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ materialId: t.materialId, kind: t.kind, force: t.force }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok && !body.status) throw new Error(body.error ?? `Error ${res.status}`);
        if (body.status === 'failed') {
          notify({ tone: 'error', text: `“${name}” (${t.kind === 'cards' ? 'fichas y flashcards' : 'infografías'}): ${body.error ?? 'No se pudo generar.'}` });
          setTaskState((p) => ({ ...p, [key(t)]: 'error' }));
          await refresh();
          return;
        }
        // Espera a que el trabajo en segundo plano termine (o se declare interrumpido).
        const started = Date.now();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (cancelRef.current) return;
          const fresh = await refresh();
          const row = fresh.find((r) => r.id === t.materialId);
          const job = t.kind === 'cards' ? row?.cards : row?.ig;
          if (job && job.status !== 'generating') {
            finalRow = job;
            break;
          }
          if (Date.now() - started > 7 * 60 * 1000) throw new Error('Se interrumpió: tardó más de lo permitido. Puedes reintentar.');
        }
      } catch (e) {
        notify({ tone: 'error', text: `“${name}”: ${(e as Error).message || 'Se perdió la conexión.'}` });
        setTaskState((p) => ({ ...p, [key(t)]: 'error' }));
        return;
      }
      const fresh = rowsRef.current.find((r) => r.id === t.materialId);
      const n = outcomeNotice(name, t.kind, finalRow, { fichas: fresh?.fichas ?? 0, flashcards: fresh?.flashcards ?? 0, infographics: fresh?.infographics ?? 0 });
      notify(n);
      setTaskState((p) => ({ ...p, [key(t)]: finalRow!.status === 'failed' ? 'error' : 'done' }));
    },
    [notify, refresh]
  );

  const start = async () => {
    const tasks = buildQueue(Array.from(selected), { cards: wantCards, infographics: wantIg }, (id) => statusOf(rowsRef.current.find((r) => r.id === id)!));
    if (tasks.length === 0) return;
    const replacing = tasks.filter((t) => t.force).length;
    if (replacing > 0 && !confirm(`${replacing === 1 ? 'Una de las tareas reemplazará' : `${replacing} de las tareas reemplazarán`} material que ya estaba listo. Los estudiantes perderán su progreso de repaso en las tarjetas reemplazadas. ¿Continuar?`)) return;
    cancelRef.current = false;
    setQueue(tasks);
    setTaskState(Object.fromEntries(tasks.map((t) => [key(t), 'waiting' as TaskState])));
    setRunning(true);
    setSelected(new Set());
    for (const t of tasks) {
      if (cancelRef.current) break;
      await runTask(t);
    }
    setRunning(false);
    setQueue([]);
    setTaskState({});
    await refresh();
  };

  const cancelQueue = () => {
    cancelRef.current = true;
    setRunning(false);
    setQueue([]);
    setTaskState({});
    notify({ tone: 'warning', text: 'Cola cancelada. Lo que ya se estaba generando en el servidor termina por su cuenta.' });
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const items = rows.map((r) => ({ id: r.id, status: statusOf(r), fichas: r.fichas, flashcards: r.flashcards }));
  const withContent = items.filter((i) => hasStudyContent(i.status, i.fichas, i.flashcards)).length;
  const pending = pendingIds(items);
  const total = rows.length;
  const done = Object.values(taskState).filter((s) => s === 'done' || s === 'error').length;
  const queueTotal = queue.length;
  const noticeSummary = summarize(notices);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-fg">
              <Sparkles aria-hidden="true" className="h-5 w-5 text-primary-text" /> Material de estudio
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">
              La IA prepara fichas de lectura, flashcards e infografías con los materiales que elijas. Tus estudiantes <strong className="text-fg">solo ven lo que generes aquí</strong>; ellos no generan nada.
            </p>
          </div>
          {total > 0 && (
            <Badge tone={withContent === total ? 'success' : 'neutral'} className="text-sm">
              {withContent} de {total} {total === 1 ? 'material listo' : 'materiales listos'}
            </Badge>
          )}
        </div>
        {total > 0 && <ProgressBar value={(withContent / total) * 100} label="Materiales con material de estudio listo" tone="success" />}
      </header>

      {total === 0 ? (
        <Card className="p-10 text-center">
          <CircleDashed aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-fg-muted" />
          <p className="font-semibold text-fg">Aún no hay materiales procesados</p>
          <p className="mt-1 text-sm text-fg-muted">Sube y procesa materiales en la pestaña Materiales. Cuando estén listos aparecerán aquí.</p>
        </Card>
      ) : (
        <>
          {/* Controles */}
          <Card className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSelected(new Set(pending))} disabled={running || pending.length === 0}>
                Seleccionar pendientes ({pending.length})
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSelected(new Set(rows.map((r) => r.id)))} disabled={running}>
                Seleccionar todos
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={running || selected.size === 0}>
                Limpiar
              </Button>
            </div>

            <fieldset className="flex flex-wrap gap-x-6 gap-y-2" disabled={running}>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Qué generar</legend>
              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={wantCards} onChange={(e) => setWantCards(e.target.checked)} className="h-5 w-5 accent-primary" />
                Fichas de lectura y flashcards
              </label>
              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={wantIg} onChange={(e) => setWantIg(e.target.checked)} className="h-5 w-5 accent-primary" />
                Infografías
              </label>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={start} disabled={running || selected.size === 0 || (!wantCards && !wantIg)} loading={running}>
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                {running ? 'Generando…' : `Generar para ${selected.size} ${selected.size === 1 ? 'material' : 'materiales'}`}
              </Button>
              {running && (
                <Button variant="secondary" onClick={cancelQueue}>
                  Cancelar cola
                </Button>
              )}
              <p className="text-xs text-fg-muted">Cada material tarda 1–3 minutos. Mantén esta página abierta mientras haya cola; lo que ya está en marcha en el servidor termina solo.</p>
            </div>

            {running && queueTotal > 0 && (
              <div role="status" aria-live="polite" className="space-y-1">
                <div className="flex justify-between text-xs text-fg-muted">
                  <span>
                    {done} de {queueTotal} {queueTotal === 1 ? 'tarea' : 'tareas'}
                  </span>
                  <span>{Math.round((done / queueTotal) * 100)}%</span>
                </div>
                <ProgressBar value={(done / queueTotal) * 100} label="Avance de la generación" />
              </div>
            )}
          </Card>

          {/* Avisos */}
          {notices.length > 0 && (
            <section aria-label="Resultados de la generación" className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg">
                  Resultados{' '}
                  <span className="font-normal text-fg-muted">
                    · {noticeSummary.ok} bien{noticeSummary.warn ? `, ${noticeSummary.warn} con avisos` : ''}
                    {noticeSummary.err ? `, ${noticeSummary.err} con error` : ''}
                  </span>
                </h3>
                <Button size="sm" variant="ghost" onClick={() => setNotices([])}>
                  Limpiar
                </Button>
              </div>
              <ul className="space-y-2" aria-live="polite">
                {notices.map((n) => (
                  <li
                    key={n.id}
                    role={n.tone === 'error' ? 'alert' : 'status'}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${
                      n.tone === 'success' ? 'border-success/40 bg-success/10 text-fg' : n.tone === 'warning' ? 'border-accent/40 bg-accent/10 text-fg' : 'border-danger/40 bg-danger/10 text-fg'
                    }`}
                  >
                    {n.tone === 'success' ? (
                      <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : n.tone === 'warning' ? (
                      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
                    ) : (
                      <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                    )}
                    <span className="min-w-0 flex-1 break-words">
                      <span className="sr-only">{n.tone === 'success' ? 'Listo: ' : n.tone === 'warning' ? 'Aviso: ' : 'Error: '}</span>
                      {n.text}
                    </span>
                    <button
                      type="button"
                      aria-label="Descartar aviso"
                      onClick={() => setNotices((p) => p.filter((x) => x.id !== n.id))}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Materiales */}
          <ul className="space-y-3" aria-label="Materiales de la clase">
            {rows.map((r) => {
              const s = statusOf(r);
              const isSelected = selected.has(r.id);
              const ready = hasStudyContent(s, r.fichas, r.flashcards);
              return (
                <li key={r.id}>
                  <Card className={`p-4 transition-colors motion-reduce:transition-none ${isSelected ? 'border-primary' : ''}`}>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id={`sel-${r.id}`}
                        checked={isSelected}
                        onChange={() => toggle(r.id)}
                        disabled={running}
                        aria-label={`Seleccionar ${r.name}`}
                        className="mt-1 h-5 w-5 shrink-0 accent-primary"
                      />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor={`sel-${r.id}`} className="cursor-pointer break-words font-semibold text-fg">
                            {r.name}
                          </label>
                          <Badge tone="neutral">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</Badge>
                          <span className="text-xs text-fg-muted">{r.chunks} secciones</span>
                          {ready && <Badge tone="success">Visible para los estudiantes</Badge>}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Chip
                            icon={<BookOpenCheck aria-hidden="true" className="h-4 w-4" />}
                            title="Fichas y flashcards"
                            state={s.cards}
                            detail={`${r.fichas} ${r.fichas === 1 ? 'ficha' : 'fichas'} · ${r.flashcards} ${r.flashcards === 1 ? 'flashcard' : 'flashcards'}`}
                            started={r.cards?.started_at ?? null}
                            now={now}
                          />
                          <Chip
                            icon={<Shapes aria-hidden="true" className="h-4 w-4" />}
                            title="Infografías"
                            state={s.infographics}
                            detail={`${r.infographics} ${r.infographics === 1 ? 'infografía' : 'infografías'}`}
                            started={r.ig?.started_at ?? null}
                            now={now}
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

const PHASE_LOOK: Record<ChipState['phase'], { label: string; tone: string; icon: React.ReactNode }> = {
  none: { label: 'Pendiente', tone: 'border-line text-fg-muted', icon: <CircleDashed aria-hidden="true" className="h-4 w-4" /> },
  queued: { label: 'En cola', tone: 'border-line-strong text-fg', icon: <Clock aria-hidden="true" className="h-4 w-4" /> },
  running: { label: 'Generando', tone: 'border-primary text-primary-text', icon: <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> },
  ready: { label: 'Listo', tone: 'border-success/50 text-success', icon: <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> },
  ready_with_notes: { label: 'Listo con avisos', tone: 'border-accent/60 text-accent-text', icon: <AlertTriangle aria-hidden="true" className="h-4 w-4" /> },
  failed: { label: 'Falló', tone: 'border-danger/60 text-danger', icon: <XCircle aria-hidden="true" className="h-4 w-4" /> },
  interrupted: { label: 'Interrumpido', tone: 'border-accent/60 text-accent-text', icon: <RefreshCw aria-hidden="true" className="h-4 w-4" /> },
};

function Chip({ icon, title, state, detail, started, now }: { icon: React.ReactNode; title: string; state: ChipState; detail: string; started: string | null; now: number }) {
  const look = PHASE_LOOK[state.phase];
  const showDetail = state.phase === 'ready' || state.phase === 'ready_with_notes';
  return (
    <div className={`rounded-xl border bg-surface-2 p-3 ${look.tone.split(' ')[0]}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex items-center gap-2 text-sm font-medium text-fg">
          {icon} {title}
        </span>
        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${look.tone.split(' ').slice(1).join(' ')}`}>
          {look.icon} {look.label}
          {state.phase === 'running' && started && <span className="tabular-nums font-normal"> · {formatElapsed(now - new Date(started).getTime())}</span>}
        </span>
      </div>
      {showDetail && <p className="mt-1 text-xs text-fg-muted">{detail}</p>}
      {state.note && (
        <p className={`mt-1 break-words text-xs ${state.phase === 'failed' ? 'text-danger' : 'text-fg-muted'}`} role={state.phase === 'failed' ? 'alert' : undefined}>
          {state.note}
        </p>
      )}
      {state.phase === 'running' && <div className="mt-2 h-1 overflow-hidden rounded-full bg-line"><div className="h-full w-1/3 animate-pulse rounded-full bg-primary motion-reduce:animate-none" /></div>}
    </div>
  );
}
