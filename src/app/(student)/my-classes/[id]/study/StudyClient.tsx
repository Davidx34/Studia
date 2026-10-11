'use client';

// Paso 3 del plan: fichas de lectura y flashcards generadas por IA desde el material de la clase, sin aprobacion
// del profesor. El avance de repaso (cajas de Leitner) es del estudiante y se guarda en student_card_state.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpenCheck, Layers, Sparkles, RotateCcw, CheckCircle2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card, Badge } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { MathText } from '@/components/MathText';
import { isDue, nextState, type Grade } from '@/lib/study/leitner';

interface StudyCard {
  id: string;
  kind: 'ficha' | 'flashcard';
  section: string | null;
  position: number;
  front: string;
  back: string;
  extra: { puntos_clave?: string[]; terminos?: { termino: string; definicion: string }[]; reflexion?: string } | null;
}

interface CardState {
  card_id: string;
  box: number;
  due_at: string;
  reviews: number;
  lapses: number;
}

type GenStatus = 'none' | 'generating' | 'ready' | 'failed';
const SESSION_SIZE = 20;
const POLL_MS = 5000;

export function StudyClient({
  userId,
  classroomId,
  classroomName,
  materials,
  initialMaterialId,
}: {
  userId: string;
  classroomId: string;
  classroomName: string;
  materials: { id: string; display_name: string }[];
  initialMaterialId: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [materialId, setMaterialId] = useState<string | null>(
    materials.find((m) => m.id === initialMaterialId)?.id ?? materials[0]?.id ?? null
  );
  const [status, setStatus] = useState<GenStatus>('none');
  const [genError, setGenError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [states, setStates] = useState<Map<string, CardState>>(new Map());
  const [tab, setTab] = useState<'fichas' | 'flashcards'>('fichas');
  const [loading, setLoading] = useState(false);
  const activeMaterial = useRef<string | null>(null);

  const loadCards = useCallback(
    async (id: string) => {
      const { data: cardRows } = await supabase
        .from('study_cards' as any)
        .select('id, kind, section, position, front, back, extra')
        .eq('material_id', id)
        .order('position');
      if (activeMaterial.current !== id) return;
      const list = ((cardRows as unknown) as StudyCard[]) ?? [];
      setCards(list);
      if (list.length > 0) {
        const { data: stateRows } = await supabase
          .from('student_card_state' as any)
          .select('card_id, box, due_at, reviews, lapses')
          .eq('student_id', userId)
          .in('card_id', list.map((c) => c.id));
        if (activeMaterial.current !== id) return;
        setStates(new Map((((stateRows as unknown) as CardState[]) ?? []).map((s) => [s.card_id, s])));
      } else {
        setStates(new Map());
      }
    },
    [supabase, userId]
  );

  const refreshStatus = useCallback(
    async (id: string) => {
      const { data } = await supabase.from('study_card_generation' as any).select('status, error').eq('material_id', id).maybeSingle();
      if (activeMaterial.current !== id) return 'none' as GenStatus;
      const row = data as unknown as { status: GenStatus; error: string | null } | null;
      const next: GenStatus = row?.status ?? 'none';
      setStatus(next);
      setGenError(next === 'failed' ? row?.error ?? null : null);
      if (next === 'ready') await loadCards(id);
      return next;
    },
    [supabase, loadCards]
  );

  useEffect(() => {
    activeMaterial.current = materialId;
    setCards([]);
    setStates(new Map());
    setStatus('none');
    setGenError(null);
    if (!materialId) return;
    setLoading(true);
    refreshStatus(materialId).finally(() => setLoading(false));
  }, [materialId, refreshStatus]);

  // Mientras otra persona (o este mismo navegador) la esta generando, se consulta cada pocos segundos.
  useEffect(() => {
    if (status !== 'generating' || !materialId) return;
    const t = setInterval(() => void refreshStatus(materialId), POLL_MS);
    return () => clearInterval(t);
  }, [status, materialId, refreshStatus]);

  const generate = async () => {
    if (!materialId) return;
    setRequesting(true);
    setGenError(null);
    setStatus('generating');
    try {
      const res = await fetch('/api/study/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materialId }),
      });
      const body = await res.json().catch(() => ({}));
      if (activeMaterial.current !== materialId) return;
      if (body.status === 'failed' || !res.ok) {
        setStatus('failed');
        setGenError(body.error ?? 'No se pudieron generar las fichas.');
      } else {
        await refreshStatus(materialId);
      }
    } catch {
      setStatus('failed');
      setGenError('Se perdió la conexión. Intenta de nuevo.');
    } finally {
      setRequesting(false);
    }
  };

  const fichas = useMemo(() => cards.filter((c) => c.kind === 'ficha'), [cards]);
  const flash = useMemo(() => cards.filter((c) => c.kind === 'flashcard'), [cards]);

  return (
    <div className="theme-scope space-y-6">
      <div>
        <Link href={`/my-classes/${classroomId}/library`} className="inline-flex items-center gap-2 min-h-[44px] text-sm text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="w-4 h-4" /> {classroomName}
        </Link>
        <h1 className="text-2xl font-bold text-fg flex items-center gap-2">
          <BookOpenCheck aria-hidden="true" className="w-6 h-6 text-primary-text" /> Estudiar
        </h1>
        <p className="text-sm text-fg-muted mt-1">Fichas de lectura y tarjetas de repaso hechas con tu material de clase.</p>
      </div>

      {materials.length === 0 ? (
        <Card className="p-8 text-center text-fg-muted">Tu profesor aún no ha subido material procesado.</Card>
      ) : (
        <>
          <div>
            <label htmlFor="material" className="block text-sm font-medium text-fg mb-1">Material</label>
            <select
              id="material"
              value={materialId ?? ''}
              onChange={(e) => setMaterialId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-line bg-surface text-fg px-3"
            >
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.display_name}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="text-fg-muted flex items-center gap-2" role="status"><Loader2 aria-hidden="true" className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Cargando…</p>
          ) : status === 'ready' ? (
            <>
              <div role="tablist" aria-label="Tipo de estudio" className="flex gap-2">
                <TabButton selected={tab === 'fichas'} onClick={() => setTab('fichas')} id="fichas" icon={<BookOpenCheck aria-hidden="true" className="w-4 h-4" />}>
                  Fichas de lectura <span className="opacity-80">({fichas.length})</span>
                </TabButton>
                <TabButton selected={tab === 'flashcards'} onClick={() => setTab('flashcards')} id="flashcards" icon={<Layers aria-hidden="true" className="w-4 h-4" />}>
                  Flashcards <span className="opacity-80">({flash.length})</span>
                </TabButton>
              </div>
              <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
                {tab === 'fichas' ? (
                  <Fichas fichas={fichas} />
                ) : (
                  <Flashcards cards={flash} states={states} userId={userId} supabase={supabase} onState={(s) => setStates((prev) => new Map(prev).set(s.card_id, s))} />
                )}
              </div>
              <p className="text-xs text-fg-muted">Generado con IA a partir del material. Si algo no cuadra, confía en el material original.</p>
            </>
          ) : status === 'generating' ? (
            <Card className="p-8 text-center space-y-2" role="status" aria-live="polite">
              <Loader2 aria-hidden="true" className="w-8 h-8 mx-auto animate-spin motion-reduce:animate-none text-primary-text" />
              <p className="font-semibold text-fg">Preparando tus fichas…</p>
              <p className="text-sm text-fg-muted">Puede tardar uno o dos minutos. Puedes quedarte en esta página; se mostrarán solas.</p>
            </Card>
          ) : (
            <Card className="p-8 text-center space-y-3">
              <Sparkles aria-hidden="true" className="w-8 h-8 mx-auto text-accent-text" />
              <p className="font-semibold text-fg">Aún no hay fichas de este material</p>
              <p className="text-sm text-fg-muted">La IA las arma una sola vez y quedan para todos tus compañeros.</p>
              {genError && <p role="alert" className="text-sm text-danger">{genError}</p>}
              <Button onClick={generate} loading={requesting}>
                {status === 'failed' ? 'Intentar de nuevo' : 'Generar fichas'}
              </Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({ selected, onClick, id, icon, children }: { selected: boolean; onClick: () => void; id: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={selected}
      aria-controls={`panel-${id}`}
      onClick={onClick}
      className={`inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold border transition motion-reduce:transition-none ${
        selected ? 'bg-primary border-primary text-on-primary' : 'bg-surface border-line text-fg-muted hover:text-fg'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Fichas({ fichas }: { fichas: StudyCard[] }) {
  if (fichas.length === 0) return <p className="text-fg-muted">Este material no produjo fichas de lectura.</p>;
  return (
    <ul className="space-y-3">
      {fichas.map((f, i) => (
        <li key={f.id}>
          <Card className="overflow-hidden">
            <details open={i === 0} className="group">
              <summary className="cursor-pointer list-none p-4 min-h-[44px] flex items-start justify-between gap-3">
                <span>
                  {f.section && <span className="block text-xs text-fg-muted mb-0.5">{f.section}</span>}
                  <span className="font-bold text-fg"><MathText content={f.front} /></span>
                </span>
                <span aria-hidden="true" className="text-fg-muted transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span>
              </summary>
              <div className="px-4 pb-4 space-y-4 border-t border-line pt-4">
                <p className="text-fg"><MathText content={f.back} /></p>
                {!!f.extra?.puntos_clave?.length && (
                  <div>
                    <h3 className="text-sm font-semibold text-primary-text mb-1">Puntos clave</h3>
                    <ul className="list-disc pl-5 space-y-1 text-fg text-sm">
                      {f.extra.puntos_clave.map((p, k) => (
                        <li key={k}><MathText content={p} /></li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!f.extra?.terminos?.length && (
                  <div>
                    <h3 className="text-sm font-semibold text-primary-text mb-1">Términos</h3>
                    <dl className="space-y-1 text-sm">
                      {f.extra.terminos.map((t, k) => (
                        <div key={k}>
                          <dt className="inline font-semibold text-fg"><MathText content={t.termino} />: </dt>
                          <dd className="inline text-fg-muted"><MathText content={t.definicion} /></dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                {f.extra?.reflexion && (
                  <p className="text-sm bg-surface-2 border border-line rounded-xl p-3 text-fg">
                    <span className="font-semibold">Para pensar: </span>
                    <MathText content={f.extra.reflexion} />
                  </p>
                )}
              </div>
            </details>
          </Card>
        </li>
      ))}
    </ul>
  );
}

const GRADES: { grade: Grade; label: string; key: string; variant: 'danger' | 'secondary' | 'primary' }[] = [
  { grade: 'again', label: 'No lo sabía', key: '1', variant: 'danger' },
  { grade: 'hard', label: 'Dudé', key: '2', variant: 'secondary' },
  { grade: 'good', label: 'Lo sabía', key: '3', variant: 'primary' },
];

function Flashcards({
  cards,
  states,
  userId,
  supabase,
  onState,
}: {
  cards: StudyCard[];
  states: Map<string, CardState>;
  userId: string;
  supabase: ReturnType<typeof createClient>;
  onState: (s: CardState) => void;
}) {
  const [queue, setQueue] = useState<string[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const dueIds = useMemo(() => cards.filter((c) => isDue(states.get(c.id))).map((c) => c.id), [cards, states]);
  const mastered = cards.filter((c) => (states.get(c.id)?.box ?? 0) >= 5).length;
  const started = cards.filter((c) => states.has(c.id)).length;

  const start = () => {
    setQueue(dueIds.slice(0, SESSION_SIZE));
    setDone(0);
    setFlipped(false);
  };

  const current = queue && queue.length > 0 ? byId.get(queue[0]) : null;

  const answer = useCallback(
    async (grade: Grade) => {
      if (!queue || queue.length === 0) return;
      const id = queue[0];
      const prev = states.get(id) ?? null;
      const next = nextState(prev, grade);
      // Se avanza de inmediato (la UI no espera a la red); si el guardado falla se avisa, pero el repaso sigue.
      setQueue((q) => {
        const rest = (q ?? []).slice(1);
        return grade === 'again' ? [...rest, id] : rest;
      });
      setFlipped(false);
      if (grade !== 'again') setDone((d) => d + 1);
      const row = { student_id: userId, card_id: id, box: next.box, due_at: next.due_at, reviews: next.reviews, lapses: next.lapses, last_reviewed_at: next.last_reviewed_at };
      onState({ card_id: id, box: next.box, due_at: next.due_at, reviews: next.reviews, lapses: next.lapses });
      const { error } = await supabase.from('student_card_state' as any).upsert(row as any, { onConflict: 'student_id,card_id' });
      setSaveError(!!error);
    },
    [queue, states, userId, supabase, onState]
  );

  // Atajos: espacio gira (el boton ya lo hace con Enter/Espacio); 1/2/3 califican cuando la tarjeta esta girada.
  useEffect(() => {
    if (!current || !flipped) return;
    const onKey = (e: KeyboardEvent) => {
      const g = GRADES.find((x) => x.key === e.key);
      if (g && !e.ctrlKey && !e.metaKey && !e.altKey) void answer(g.grade);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, flipped, answer]);

  if (cards.length === 0) return <p className="text-fg-muted">Este material no produjo flashcards.</p>;

  if (!queue) {
    return (
      <Card className="p-6 space-y-4">
        <dl className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Pendientes" value={dueIds.length} />
          <Stat label="En repaso" value={started} />
          <Stat label="Dominadas" value={mastered} />
        </dl>
        <ProgressBar value={cards.length ? (mastered / cards.length) * 100 : 0} label="Flashcards dominadas" tone="success" />
        {dueIds.length > 0 ? (
          <Button size="lg" className="w-full" onClick={start}>
            Repasar {Math.min(dueIds.length, SESSION_SIZE)} tarjetas
          </Button>
        ) : (
          <p className="text-center text-fg-muted flex items-center justify-center gap-2">
            <CheckCircle2 aria-hidden="true" className="w-5 h-5 text-success" /> Estás al día. Vuelve más tarde.
          </p>
        )}
      </Card>
    );
  }

  if (!current) {
    return (
      <Card className="p-8 text-center space-y-3" role="status">
        <CheckCircle2 aria-hidden="true" className="w-10 h-10 mx-auto text-success" />
        <p className="font-bold text-fg">¡Sesión completa! Repasaste {done} tarjetas.</p>
        <Button variant="secondary" onClick={() => setQueue(null)}>
          <RotateCcw aria-hidden="true" className="w-4 h-4" /> Volver
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-fg-muted">
        <span>{done} hechas · quedan {queue.length}</span>
        <Badge tone="neutral">Caja {states.get(current.id)?.box ?? 1} de 5</Badge>
      </div>
      <Card className="p-6 min-h-[200px] flex flex-col justify-center gap-4">
        {current.section && <p className="text-xs text-fg-muted">{current.section}</p>}
        <p className="text-lg font-semibold text-fg"><MathText content={current.front} /></p>
        {flipped ? (
          <div className="border-t border-line pt-4" aria-live="polite">
            <p className="text-fg"><MathText content={current.back} /></p>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setFlipped(true)} className="self-start">
            Mostrar respuesta
          </Button>
        )}
      </Card>
      {flipped && (
        <div className="grid grid-cols-3 gap-2">
          {GRADES.map((g) => (
            <Button key={g.grade} variant={g.variant} onClick={() => void answer(g.grade)} aria-keyshortcuts={g.key}>
              {g.label}
            </Button>
          ))}
        </div>
      )}
      {saveError && <p role="alert" className="text-sm text-danger">No se pudo guardar tu avance. Revisa tu conexión.</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-2 border border-line rounded-xl p-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-2xl font-bold text-fg tabular-nums">{value}</dd>
    </div>
  );
}
