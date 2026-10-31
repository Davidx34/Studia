'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { CHECK_ERROR, textMap, textOrNull, type GameCheck } from './serverCheck';

interface CategoryItem {
  id: number;
  text: string;
  // Solo en el modo del navegador: con calificacion en el servidor la categoria correcta NO viaja.
  correct_category?: string;
}

interface GameData {
  theme?: string;
  categories: string[];
  items: CategoryItem[];
  time_limit_seconds?: number;
  pedagogical_feedback?: string;
}

const DEFAULT_TIME = 60;
const MAX_ATTEMPTS = 2; // 1 reintento tras agotar el tiempo, luego revela
const NUDGES = ['¡Vamos, tú puedes! 💪', '¡Sigue así! ⏱️', '¡Ya casi lo tienes!'];
const URGENT_NUDGE = '¡Apresúrate! ⏰';

function shuffledIndices(n: number): number[] {
  const idxs = Array.from({ length: n }, (_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  return idxs;
}

// Tap-to-classify en vez de drag & drop (mismo patron que LessonQuestionMatch /
// TimelineGame): tocar un item y luego una categoria lo clasifica.
//
// Con `check` (calificacion en el servidor): cada toque pregunta al servidor si esa categoria es la del elemento (un "sondeo": no cierra la pregunta ni gasta intentos, igual que
// el juego daba retroalimentacion inmediata y sin penalizacion); al clasificar todo se manda la clasificacion completa para cerrar la pregunta, y el tiempo agotado se informa
// como intento fallido. La clasificacion correcta se revela al cerrar.
export function CategoriesGame({
  gameData,
  disabled,
  onComplete,
  check,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
  check?: GameCheck;
}) {
  const items = gameData.items || [];
  const categories = gameData.categories || [];
  const timeLimit = gameData.time_limit_seconds || DEFAULT_TIME;

  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);
  const showMessage = useTonitoStore((s) => s.showMessage);
  const setMood = useTonitoStore((s) => s.setMood);

  const order = useMemo(() => shuffledIndices(items.length), [items]);

  const [placed, setPlaced] = useState<Record<number, boolean>>({}); // itemId -> correctamente clasificado
  const [assignment, setAssignment] = useState<Record<string, string>>({}); // itemId -> categoria (solo servidor: es lo que se manda al cerrar)
  const [flashWrong, setFlashWrong] = useState<number | null>(null); // itemId con flash rojo momentaneo
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [attempts, setAttempts] = useState(0);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  const [timeoutMsg, setTimeoutMsg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ assignment: Record<string, string>; explanation: string | null } | null>(null);

  const urgentFired = useRef(false);
  const locked = disabled || finished !== null || busy;
  const allPlaced = items.length > 0 && items.every((it) => placed[it.id]);

  function resetBoard() {
    setTimeoutMsg(true);
    setPlaced({});
    setAssignment({});
    setSelectedId(null);
    setTimeLeft(timeLimit);
    urgentFired.current = false;
    setTimeout(() => setTimeoutMsg(false), 2000);
  }

  // Countdown.
  useEffect(() => {
    if (locked) return;
    if (timeLeft <= 0) {
      onWrongAnswer();
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      if (check) {
        // Servidor: el tiempo agotado es un intento fallido; SU cuenta decide si ya se cierra. Si no responde, manda la cuenta del navegador.
        setBusy(true);
        void check({ timeout: true }).then((verdict) => {
          setBusy(false);
          const closes = verdict ? verdict.final !== false : nextAttempts >= MAX_ATTEMPTS;
          if (closes) {
            if (verdict) setRevealed({ assignment: textMap(verdict.reveal?.assignment), explanation: textOrNull(verdict.reveal?.explanation) ?? verdict.explanation ?? null });
            setFinished('lost');
            onComplete(false);
          } else {
            resetBoard();
          }
        });
        return;
      }
      if (nextAttempts >= MAX_ATTEMPTS) {
        setFinished('lost');
        onComplete(false);
      } else {
        resetBoard();
      }
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, locked]);

  // Toñito anima cada 10s, con mensaje urgente cuando quedan <=10s.
  useEffect(() => {
    if (locked) return;
    if (timeLeft <= 10 && !urgentFired.current) {
      urgentFired.current = true;
      setMood('encouraging');
      showMessage(URGENT_NUDGE, 2000);
      return;
    }
    if (timeLeft > 10 && timeLeft % 10 === 0) {
      showMessage(NUDGES[Math.floor(Math.random() * NUDGES.length)], 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, locked]);

  function handleSelectItem(id: number) {
    if (locked || placed[id]) return;
    setSelectedId((prev) => (prev === id ? null : id));
  }

  // Cierra la pregunta en el servidor con la clasificacion completa.
  async function finalize(finalAssignment: Record<string, string>) {
    setError(null);
    setBusy(true);
    const verdict = await check!({ assignment: finalAssignment });
    setBusy(false);
    if (!verdict) {
      setError(CHECK_ERROR);
      return;
    }
    setRevealed({ assignment: textMap(verdict.reveal?.assignment), explanation: textOrNull(verdict.reveal?.explanation) ?? verdict.explanation ?? null });
    if (verdict.correct) {
      setFinished('won');
      onComplete(true);
    } else {
      setFinished('lost');
      onComplete(false);
    }
  }

  function markPlaced(item: CategoryItem, cat: string) {
    onCorrectAnswer();
    const next = { ...placed, [item.id]: true };
    setPlaced(next);
    setSelectedId(null);
    return next;
  }

  async function handleSelectCategory(cat: string) {
    if (locked || selectedId === null) return;
    const item = items.find((it) => it.id === selectedId)!;

    if (!check) {
      if (item.correct_category === cat) {
        const next = markPlaced(item, cat);
        if (items.every((it) => next[it.id])) {
          setFinished('won');
          onComplete(true);
        }
      } else {
        onWrongAnswer();
        setFlashWrong(item.id);
        setTimeout(() => setFlashWrong(null), 400);
        setSelectedId(null);
      }
      return;
    }

    setError(null);
    setBusy(true);
    const probe = await check({ probe: { itemId: item.id, category: cat } });
    setBusy(false);
    if (!probe) {
      setError(CHECK_ERROR);
      return;
    }
    if (probe.correct) {
      const next = markPlaced(item, cat);
      const nextAssignment = { ...assignment, [String(item.id)]: cat };
      setAssignment(nextAssignment);
      if (items.every((it) => next[it.id])) await finalize(nextAssignment);
    } else {
      onWrongAnswer();
      setFlashWrong(item.id);
      setTimeout(() => setFlashWrong(null), 400);
      setSelectedId(null);
    }
  }

  const timeUrgent = timeLeft <= 10;
  const correctByCategory = (cat: string) =>
    items.filter((it) => (revealed ? revealed.assignment[String(it.id)] === cat : it.correct_category === cat)).map((it) => it.text).join(', ');
  const explanation = revealed ? revealed.explanation : gameData.pedagogical_feedback;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-fg-muted text-sm">Toca un elemento y luego su categoría correcta</p>
        <div
          className={
            'px-3 py-1.5 rounded-lg font-mono font-bold text-sm border-2 transition-colors ' +
            (finished
              ? 'bg-surface-2 border-line-strong text-fg-muted'
              : timeUrgent
              ? 'bg-danger/10 border-danger text-fg animate-pulse'
              : 'bg-surface-2 border-line-strong text-fg')
          }
        >
          ⏱️ {timeLeft}s
        </div>
      </div>

      {timeoutMsg && (
        <div className="bg-accent/15 border border-accent p-3 rounded-lg text-fg text-sm font-medium">
          ⏰ Se acabó el tiempo. ¡Intenta de nuevo!
        </div>
      )}

      <div className={`grid gap-2 ${categories.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => handleSelectCategory(cat)}
            disabled={locked || selectedId === null}
            className="p-3 rounded-lg text-center font-bold text-sm border-2 bg-primary/10 border-primary/40 text-fg hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {order.map((idx) => {
          const item = items[idx];
          const isPlaced = placed[item.id];
          const isSelected = selectedId === item.id;
          const isWrong = flashWrong === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleSelectItem(item.id)}
              disabled={locked || isPlaced}
              className={
                'px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ' +
                (isPlaced
                  ? 'bg-success/15 border-success text-fg opacity-70'
                  : isWrong
                  ? 'bg-danger/15 border-danger text-fg'
                  : isSelected
                  ? 'bg-primary border-accent text-on-primary scale-105'
                  : 'bg-surface-2 border-line-strong text-fg hover:border-primary')
              }
            >
              {item.text} {isPlaced && '✓'}
            </button>
          );
        })}
      </div>

      {busy && <p className="text-fg-muted text-sm" aria-live="polite">Comprobando…</p>}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
          {check && allPlaced && finished === null && (
            <button onClick={() => finalize(assignment)} disabled={busy} className="px-3 py-2 rounded-lg bg-primary text-on-primary text-sm font-bold disabled:opacity-40">
              Reintentar
            </button>
          )}
        </div>
      )}

      {finished === 'won' && (
        <div className="bg-success/10 border border-success p-4 rounded-lg">
          <p className="text-success font-bold">🎉 ¡Todo clasificado correctamente! ({timeLimit - timeLeft}s)</p>
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-primary/10 border border-primary/40 p-4 rounded-lg space-y-1">
          <p className="text-primary-text font-bold">Clasificación correcta:</p>
          {categories.map((cat) => (
            <p key={cat} className="text-fg text-sm">
              <strong>{cat}:</strong> {correctByCategory(cat)}
            </p>
          ))}
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}
    </div>
  );
}
