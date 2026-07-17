'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';

interface CategoryItem {
  id: number;
  text: string;
  correct_category: string;
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
export function CategoriesGame({
  gameData,
  disabled,
  onComplete,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
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
  const [flashWrong, setFlashWrong] = useState<number | null>(null); // itemId con flash rojo momentaneo
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [attempts, setAttempts] = useState(0);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  const [timeoutMsg, setTimeoutMsg] = useState(false);

  const urgentFired = useRef(false);
  const locked = disabled || finished !== null;
  const allPlaced = items.length > 0 && items.every((it) => placed[it.id]);

  // Countdown.
  useEffect(() => {
    if (locked) return;
    if (timeLeft <= 0) {
      onWrongAnswer();
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      if (nextAttempts >= MAX_ATTEMPTS) {
        setFinished('lost');
        onComplete(false);
      } else {
        setTimeoutMsg(true);
        setPlaced({});
        setSelectedId(null);
        setTimeLeft(timeLimit);
        urgentFired.current = false;
        setTimeout(() => setTimeoutMsg(false), 2000);
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

  function handleSelectCategory(cat: string) {
    if (locked || selectedId === null) return;
    const item = items.find((it) => it.id === selectedId)!;
    if (item.correct_category === cat) {
      onCorrectAnswer();
      const next = { ...placed, [item.id]: true };
      setPlaced(next);
      setSelectedId(null);
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
  }

  const timeUrgent = timeLeft <= 10;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-gray-300 text-sm">Toca un elemento y luego su categoría correcta</p>
        <div
          className={
            'px-3 py-1.5 rounded-lg font-mono font-bold text-sm border-2 transition-colors ' +
            (finished
              ? 'bg-gray-800 border-gray-700 text-gray-400'
              : timeUrgent
              ? 'bg-red-900 border-red-500 text-red-200 animate-pulse'
              : 'bg-gray-800 border-gray-600 text-gray-200')
          }
        >
          ⏱️ {timeLeft}s
        </div>
      </div>

      {timeoutMsg && (
        <div className="bg-amber-900 border border-amber-500 p-3 rounded-lg text-amber-200 text-sm font-medium">
          ⏰ Se acabó el tiempo. ¡Intenta de nuevo!
        </div>
      )}

      <div className={`grid gap-2 ${categories.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => handleSelectCategory(cat)}
            disabled={locked || selectedId === null}
            className="p-3 rounded-lg text-center font-bold text-sm border-2 bg-blue-900 border-blue-600 text-blue-100 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
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
                  ? 'bg-green-700 border-green-400 text-white opacity-70'
                  : isWrong
                  ? 'bg-red-700 border-red-400 text-white'
                  : isSelected
                  ? 'bg-purple-600 border-yellow-300 text-white scale-105'
                  : 'bg-gray-700 border-gray-600 text-gray-100 hover:border-purple-400')
              }
            >
              {item.text} {isPlaced && '✓'}
            </button>
          );
        })}
      </div>

      {finished === 'won' && (
        <div className="bg-green-900 border border-green-500 p-4 rounded-lg">
          <p className="text-green-300 font-bold">🎉 ¡Todo clasificado correctamente! ({timeLimit - timeLeft}s)</p>
          {gameData.pedagogical_feedback && (
            <p className="text-green-100 text-sm mt-1">{gameData.pedagogical_feedback}</p>
          )}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-blue-900 border border-blue-500 p-4 rounded-lg space-y-1">
          <p className="text-blue-300 font-bold">Clasificación correcta:</p>
          {categories.map((cat) => (
            <p key={cat} className="text-blue-100 text-sm">
              <strong>{cat}:</strong> {items.filter((it) => it.correct_category === cat).map((it) => it.text).join(', ')}
            </p>
          ))}
          {gameData.pedagogical_feedback && (
            <p className="text-blue-100 text-sm mt-1">{gameData.pedagogical_feedback}</p>
          )}
        </div>
      )}
    </div>
  );
}
