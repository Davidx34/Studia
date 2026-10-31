'use client';
import { useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { CHECK_ERROR, idList, textOrNull, type GameCheck } from './serverCheck';

interface Statement {
  id: number;
  text: string;
  // Solo en el modo del navegador: con calificacion en el servidor la afirmacion falsa NO viaja.
  is_impostor?: boolean;
}

interface GameData {
  context?: string;
  statements: Statement[];
  exposicion_del_impostor?: string;
}

// Minijuego 2 del catalogo (El Impostor Cognitivo): tap-to-accuse, un solo
// intento — 2 afirmaciones verdaderas y 1 falsa ("el impostor"), el
// estudiante debe señalar cual es la falsa.
//
// Con `check` (calificacion en el servidor) la solucion llega DESPUES de acusar.
export function ImpostorCognitivoGame({
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
  const statements = gameData.statements || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const [accusedId, setAccusedId] = useState<number | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lo que revela el servidor (solo con `check`).
  const [revealed, setRevealed] = useState<{ impostorIds: (string | number)[]; explanation: string | null } | null>(null);

  const locked = disabled || finished !== null || checking;

  function finish(correct: boolean) {
    if (correct) {
      onCorrectAnswer();
      setFinished('won');
    } else {
      onWrongAnswer();
      setFinished('lost');
    }
    onComplete(correct);
  }

  async function handleAccuse(st: Statement) {
    if (locked) return;
    setAccusedId(st.id);
    setError(null);
    if (!check) {
      finish(st.is_impostor === true);
      return;
    }
    setChecking(true);
    const verdict = await check({ selectedId: st.id });
    setChecking(false);
    if (!verdict) {
      setAccusedId(null);
      setError(CHECK_ERROR);
      return;
    }
    setRevealed({ impostorIds: idList(verdict.reveal?.impostorIds), explanation: textOrNull(verdict.reveal?.explanation) ?? verdict.explanation ?? null });
    finish(verdict.correct);
  }

  const isImpostor = (s: Statement) => (revealed ? revealed.impostorIds.includes(s.id) : s.is_impostor === true);
  const impostor = statements.find(isImpostor);
  const explanation = revealed ? revealed.explanation : gameData.exposicion_del_impostor;

  return (
    <div className="space-y-4">
      {gameData.context && <p className="text-fg-muted text-sm">{gameData.context}</p>}
      <p className="text-primary-text text-xs font-semibold uppercase tracking-wide">
        🕵️ ¿Cuál de estas afirmaciones es el impostor (falsa)?
      </p>

      <div className="space-y-2">
        {statements.map((st) => {
          const isAccused = accusedId === st.id;
          const revealAsImpostor = finished !== null && isImpostor(st);
          return (
            <button
              key={st.id}
              onClick={() => handleAccuse(st)}
              disabled={locked}
              className={
                'w-full text-left p-4 rounded-lg border-2 text-sm font-medium transition-all ' +
                (revealAsImpostor
                  ? 'bg-danger/15 border-danger text-fg'
                  : isAccused
                  ? finished === 'won'
                    ? 'bg-success/15 border-success text-fg'
                    : finished === 'lost'
                    ? 'bg-danger/15 border-danger text-fg'
                    : 'bg-primary/10 border-primary text-fg'
                  : finished !== null
                  ? 'bg-surface-2 border-line-strong text-fg-muted'
                  : 'bg-surface-2 border-line-strong text-fg hover:border-primary')
              }
            >
              {st.text} {revealAsImpostor && '🎭'}
            </button>
          );
        })}
      </div>

      {checking && <p className="text-fg-muted text-sm" aria-live="polite">Comprobando…</p>}
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {finished === 'won' && (
        <div className="bg-success/10 border border-success p-4 rounded-lg">
          <p className="text-success font-bold">🎉 ¡Atrapaste al impostor!</p>
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-primary/10 border border-primary/40 p-4 rounded-lg">
          <p className="text-primary-text font-bold">El impostor era: "{impostor?.text}"</p>
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}
    </div>
  );
}
