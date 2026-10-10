'use client';
import { useMemo, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';

interface TimelineItem {
  id: number;
  text: string;
  correct_position: number;
  year?: string;
}

interface GameData {
  theme?: string;
  items: TimelineItem[];
  pedagogical_feedback?: string;
}

const MAX_ATTEMPTS = 3;

function shuffledIndices(n: number): number[] {
  const idxs = Array.from({ length: n }, (_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  return idxs;
}

// Tap-to-place en vez de drag & drop: mas confiable en mobile y consistente
// con el patron ya usado en LessonQuestionMatch (Conectar Conceptos).
export function TimelineGame({
  gameData,
  disabled,
  onComplete,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
}) {
  const items = gameData.items || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const order = useMemo(() => shuffledIndices(items.length), [items]);

  const [placed, setPlaced] = useState<number[]>([]); // indices (en `items`) en el orden que el estudiante tapeo
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<'wrong' | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);

  const locked = disabled || finished !== null;
  const bank = order.filter((idx) => !placed.includes(idx));

  function handleTapBank(idx: number) {
    if (locked || feedback) return;
    setPlaced((prev) => [...prev, idx]);
  }

  function handleTapSlot(pos: number) {
    if (locked || feedback) return;
    // Tocar un slot ya lleno lo devuelve al banco (deshacer).
    setPlaced((prev) => prev.filter((_, i) => i !== pos));
  }

  function handleCheck() {
    if (locked || placed.length !== items.length) return;
    const correct = placed.every((idx, pos) => items[idx].correct_position === pos + 1);

    if (correct) {
      onCorrectAnswer();
      setFinished('won');
      onComplete(true);
      return;
    }

    onWrongAnswer();
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    if (nextAttempts >= MAX_ATTEMPTS) {
      setFinished('lost');
      onComplete(false);
    } else {
      setFeedback('wrong');
      setTimeout(() => {
        setPlaced([]);
        setFeedback(null);
      }, 1200);
    }
  }

  const correctOrder = [...items].sort((a, b) => a.correct_position - b.correct_position);

  return (
    <div className="space-y-4">
      <p className="text-fg-muted text-sm">Toca los eventos en el orden correcto (del más antiguo al más reciente)</p>

      <div className="space-y-2">
        {Array.from({ length: items.length }, (_, pos) => {
          const idx = placed[pos];
          const item = idx !== undefined ? items[idx] : null;
          const wrongHere = finished === 'lost' ? false : feedback === 'wrong' && item && item.correct_position !== pos + 1;
          return (
            <button
              key={pos}
              onClick={() => item && handleTapSlot(pos)}
              disabled={locked || !item}
              className={
                'w-full flex items-center gap-3 p-3 rounded-lg text-left border-2 transition-all ' +
                (finished === 'won'
                  ? 'bg-success/15 border-success text-fg'
                  : wrongHere
                  ? 'bg-danger/10 border-danger text-fg'
                  : item
                  ? 'bg-primary/20 border-primary/60 text-fg'
                  : 'bg-surface-2 border-dashed border-line-strong text-fg-muted')
              }
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-black/25 flex items-center justify-center text-xs font-bold">
                {pos + 1}
              </span>
              <span className="flex-1">{item ? item.text : 'Toca un evento para colocarlo aquí'}</span>
              {item?.year && <span className="text-xs opacity-70">{item.year}</span>}
            </button>
          );
        })}
      </div>

      {feedback === 'wrong' && (
        <div className="bg-danger/10 border border-danger p-3 rounded-lg text-fg text-sm font-medium">
          Ese orden no es correcto. Intenta de nuevo ({MAX_ATTEMPTS - attempts} intento{MAX_ATTEMPTS - attempts === 1 ? '' : 's'} restante{MAX_ATTEMPTS - attempts === 1 ? '' : 's'}).
        </div>
      )}

      {!locked && bank.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-fg-muted uppercase tracking-wide">Eventos disponibles</p>
          <div className="flex flex-wrap gap-2">
            {bank.map((idx) => (
              <button
                key={idx}
                onClick={() => handleTapBank(idx)}
                className="px-3 py-2 rounded-lg bg-surface-2 border-2 border-line-strong text-fg text-sm hover:border-primary transition-all"
              >
                {items[idx].text}
              </button>
            ))}
          </div>
        </div>
      )}

      {!locked && (
        <button
          onClick={handleCheck}
          disabled={placed.length !== items.length || !!feedback}
          className="w-full p-4 rounded-lg bg-primary text-on-primary font-bold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Verificar orden
        </button>
      )}

      {finished === 'won' && (
        <div className="bg-success/10 border border-success p-4 rounded-lg">
          <p className="text-success font-bold">🎉 ¡Orden correcto!</p>
          {gameData.pedagogical_feedback && (
            <p className="text-fg text-sm mt-1">{gameData.pedagogical_feedback}</p>
          )}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-primary/10 border border-primary/40 p-4 rounded-lg space-y-2">
          <p className="text-primary-text font-bold">El orden correcto era:</p>
          <ol className="list-decimal list-inside text-fg text-sm space-y-0.5">
            {correctOrder.map((item) => (
              <li key={item.id}>{item.text}{item.year ? ` (${item.year})` : ''}</li>
            ))}
          </ol>
          {gameData.pedagogical_feedback && (
            <p className="text-fg text-sm mt-1">{gameData.pedagogical_feedback}</p>
          )}
        </div>
      )}
    </div>
  );
}
