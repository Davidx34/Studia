'use client';
import { useMemo, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { CHECK_ERROR, boolList, idList, textOrNull, type GameCheck } from './serverCheck';

interface TimelineItem {
  id: number;
  text: string;
  // Solo en el modo del navegador: con calificacion en el servidor la posicion correcta NO viaja.
  correct_position?: number;
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
//
// Con `check` (calificacion en el servidor) el orden se manda al servidor: tras un intento fallido solo se sabe QUE POSICIONES estaban mal (lo mismo que mostraba el juego
// por su cuenta), y el orden correcto se revela al cerrar la pregunta.
export function TimelineGame({
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
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const order = useMemo(() => shuffledIndices(items.length), [items]);

  const [placed, setPlaced] = useState<number[]>([]); // indices (en `items`) en el orden que el estudiante tapeo
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<'wrong' | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Servidor: posiciones que estaban mal en el ultimo intento, y lo que se revela al cerrar.
  const [wrongSlots, setWrongSlots] = useState<boolean[] | null>(null);
  const [revealed, setRevealed] = useState<{ correctOrder: (string | number)[]; explanation: string | null } | null>(null);

  const locked = disabled || finished !== null || checking;
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

  // Intento fallido: marca lo que estaba mal y, si quedan intentos, limpia el tablero; si no, cierra.
  function failedAttempt(close: boolean, byServer = false) {
    onWrongAnswer();
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    // Con el servidor, SU cuenta de intentos manda (la del navegador podria no coincidir si la pagina se recargo).
    if (close || (!byServer && nextAttempts >= MAX_ATTEMPTS)) {
      setFinished('lost');
      onComplete(false);
    } else {
      setFeedback('wrong');
      setTimeout(() => {
        setPlaced([]);
        setFeedback(null);
        setWrongSlots(null);
      }, 1200);
    }
  }

  async function handleCheck() {
    if (locked || placed.length !== items.length) return;
    setError(null);

    if (!check) {
      const correct = placed.every((idx, pos) => items[idx].correct_position === pos + 1);
      if (correct) {
        onCorrectAnswer();
        setFinished('won');
        onComplete(true);
        return;
      }
      failedAttempt(false);
      return;
    }

    setChecking(true);
    const verdict = await check({ order: placed.map((idx) => items[idx].id) });
    setChecking(false);
    if (!verdict) {
      setError(CHECK_ERROR);
      return;
    }
    const closes = verdict.final !== false;
    if (closes) setRevealed({ correctOrder: idList(verdict.reveal?.correctOrder), explanation: textOrNull(verdict.reveal?.explanation) ?? verdict.explanation ?? null });
    if (verdict.correct) {
      onCorrectAnswer();
      setFinished('won');
      onComplete(true);
      return;
    }
    setWrongSlots(boolList(verdict.detail?.perSlot));
    failedAttempt(closes, true);
  }

  const correctOrder = revealed
    ? revealed.correctOrder.map((id) => items.find((it) => it.id === id)).filter((it): it is TimelineItem => !!it)
    : [...items].sort((a, b) => (a.correct_position ?? 0) - (b.correct_position ?? 0));
  const explanation = revealed ? revealed.explanation : gameData.pedagogical_feedback;

  return (
    <div className="space-y-4">
      <p className="text-fg-muted text-sm">Toca los eventos en el orden correcto (del más antiguo al más reciente)</p>

      <div className="space-y-2">
        {Array.from({ length: items.length }, (_, pos) => {
          const idx = placed[pos];
          const item = idx !== undefined ? items[idx] : null;
          const isWrongSlot = wrongSlots ? wrongSlots[pos] === false : !!item && item.correct_position !== pos + 1;
          const wrongHere = finished === 'lost' ? false : feedback === 'wrong' && item && isWrongSlot;
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

      {checking && <p className="text-fg-muted text-sm" aria-live="polite">Comprobando…</p>}
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
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
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
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
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}
    </div>
  );
}
