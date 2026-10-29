'use client';

// Fichas de lectura, flashcards e infografias hechas por IA con el material de la clase. Las prepara el PROFESOR desde
// su panel (pestana "Material de estudio"); aqui el estudiante solo las ve. El avance de repaso (cajas de Leitner) es
// del estudiante y se guarda en student_card_state.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpenCheck, Layers, Sparkles, RotateCcw, CheckCircle2, Loader2, Shapes } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card, Badge } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { MathText } from '@/components/MathText';
import { isDue, nextState, type Grade } from '@/lib/study/leitner';
import { REVIEW_SESSION_SIZE } from '@/lib/study/constants';
import { InfographicView } from '@/components/study/InfographicView';
import { FichaList } from '@/components/study/fichas/FichaViews';
import type { FichaData } from '@/lib/study/fichaTemplates';
import type { Infographic } from '@/lib/study/infographics';

interface StudyCard {
  id: string;
  kind: 'ficha' | 'flashcard' | 'infografia';
  section: string | null;
  position: number;
  front: string;
  back: string;
  extra: ({ puntos_clave?: string[]; terminos?: { termino: string; definicion: string }[]; reflexion?: string } & Partial<Infographic>) | null;
}

interface CardState {
  card_id: string;
  box: number;
  due_at: string;
  reviews: number;
  lapses: number;
}

const SESSION_SIZE = REVIEW_SESSION_SIZE;

export interface StudyMaterial {
  id: string;
  display_name: string;
  fichas: number;
  flashcards: number;
  infographics: number;
}

// El estudiante SOLO ve el material de estudio que su profesor ya preparo (no genera nada).
export function StudyClient({
  userId,
  classroomId,
  classroomName,
  fichaTemplate,
  infographicTemplate,
  materials,
  initialMaterialId,
}: {
  userId: string;
  classroomId: string;
  classroomName: string;
  // Plantilla con que el profesor eligio mostrar las fichas (null = la de siempre).
  fichaTemplate: string | null;
  // Plantilla con que el profesor eligio mostrar las infografias (null = la de siempre).
  infographicTemplate: string | null;
  materials: StudyMaterial[];
  initialMaterialId: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [materialId, setMaterialId] = useState<string | null>(
    materials.find((m) => m.id === initialMaterialId)?.id ?? materials[0]?.id ?? null
  );
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [states, setStates] = useState<Map<string, CardState>>(new Map());
  const [tab, setTab] = useState<'fichas' | 'flashcards' | 'infografias'>('fichas');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const activeMaterial = useRef<string | null>(null);

  const current = materials.find((m) => m.id === materialId) ?? null;
  const available = useMemo(
    () => ({
      fichas: (current?.fichas ?? 0) > 0,
      flashcards: (current?.flashcards ?? 0) > 0,
      infografias: (current?.infographics ?? 0) > 0,
    }),
    [current]
  );

  // Al cambiar de material se abre la primera pestana que tenga contenido.
  useEffect(() => {
    setTab(available.fichas ? 'fichas' : available.flashcards ? 'flashcards' : 'infografias');
  }, [available]);

  const loadCards = useCallback(
    async (id: string) => {
      setLoading(true);
      setLoadError(false);
      const { data: cardRows, error } = await supabase
        .from('study_cards' as any)
        .select('id, kind, section, position, front, back, extra')
        .eq('material_id', id)
        .order('position');
      if (activeMaterial.current !== id) return;
      if (error) {
        setLoadError(true);
        setLoading(false);
        return;
      }
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
      setLoading(false);
    },
    [supabase, userId]
  );

  useEffect(() => {
    activeMaterial.current = materialId;
    setCards([]);
    setStates(new Map());
    if (materialId) void loadCards(materialId);
  }, [materialId, loadCards]);

  const fichas = useMemo(() => cards.filter((c) => c.kind === 'ficha'), [cards]);
  const flash = useMemo(() => cards.filter((c) => c.kind === 'flashcard'), [cards]);
  const infographics = useMemo(() => cards.filter((c) => c.kind === 'infografia'), [cards]);

  return (
    <div className="theme-scope space-y-6">
      <div>
        <Link href={`/my-classes/${classroomId}/library`} className="inline-flex items-center gap-2 min-h-[44px] text-sm text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden="true" className="w-4 h-4" /> {classroomName}
        </Link>
        <h1 className="text-2xl font-bold text-fg flex items-center gap-2">
          <BookOpenCheck aria-hidden="true" className="w-6 h-6 text-primary-text" /> Estudiar
        </h1>
        <p className="text-sm text-fg-muted mt-1">Fichas de lectura, tarjetas de repaso e infografías que tu profesor preparó con el material de la clase.</p>
      </div>

      {materials.length === 0 ? (
        <Card className="p-8 text-center space-y-2">
          <Sparkles aria-hidden="true" className="w-8 h-8 mx-auto text-accent-text" />
          <p className="font-semibold text-fg">Tu profesor aún no ha preparado material de estudio</p>
          <p className="text-sm text-fg-muted">Cuando lo haga, aparecerá aquí. Mientras tanto puedes leer los materiales en la biblioteca de la clase.</p>
          <Link href={`/my-classes/${classroomId}/library`} className="inline-flex min-h-[44px] items-center text-sm font-medium text-primary-text underline-offset-4 hover:underline">
            Ir a la biblioteca
          </Link>
        </Card>
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

          <div role="tablist" aria-label="Tipo de estudio" className="flex gap-2 flex-wrap">
            {available.fichas && (
              <TabButton selected={tab === 'fichas'} onClick={() => setTab('fichas')} id="fichas" icon={<BookOpenCheck aria-hidden="true" className="w-4 h-4" />}>
                Fichas de lectura <span className="opacity-80">({current?.fichas})</span>
              </TabButton>
            )}
            {available.flashcards && (
              <TabButton selected={tab === 'flashcards'} onClick={() => setTab('flashcards')} id="flashcards" icon={<Layers aria-hidden="true" className="w-4 h-4" />}>
                Flashcards <span className="opacity-80">({current?.flashcards})</span>
              </TabButton>
            )}
            {available.infografias && (
              <TabButton selected={tab === 'infografias'} onClick={() => setTab('infografias')} id="infografias" icon={<Shapes aria-hidden="true" className="w-4 h-4" />}>
                Infografías <span className="opacity-80">({current?.infographics})</span>
              </TabButton>
            )}
          </div>

          {loading ? (
            <p className="text-fg-muted flex items-center gap-2" role="status"><Loader2 aria-hidden="true" className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Cargando…</p>
          ) : loadError ? (
            <Card className="p-6 text-center space-y-3" role="alert">
              <p className="text-danger">No se pudo cargar este material. Revisa tu conexión.</p>
              <Button variant="secondary" onClick={() => materialId && void loadCards(materialId)}>Reintentar</Button>
            </Card>
          ) : (
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'fichas' ? (
                <FichaList fichas={fichas as unknown as FichaData[]} template={fichaTemplate} />
              ) : tab === 'flashcards' ? (
                <Flashcards cards={flash} states={states} userId={userId} supabase={supabase} onState={(s) => setStates((prev) => new Map(prev).set(s.card_id, s))} />
              ) : (
                <ul className="space-y-6">
                  {infographics.map((c) => (
                    <li key={c.id}>
                      <InfographicView title={c.front} section={c.section} data={c.extra as unknown as Infographic} template={infographicTemplate} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-xs text-fg-muted">Generado con IA a partir del material. Si algo no cuadra, confía en el material original.</p>
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
