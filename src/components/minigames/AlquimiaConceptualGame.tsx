'use client';
import { useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { CHECK_ERROR, idList, textOrNull, type GameCheck } from './serverCheck';

interface BridgeOption {
  id: string;
  text: string;
  // Solo en el modo del navegador: con calificacion en el servidor la opcion correcta NO viaja.
  is_correct?: boolean;
}

interface GameData {
  fusion_title?: string;
  element_a: string;
  element_b: string;
  alchemy_enigma: string;
  bridge_options: BridgeOption[];
  unlocked_knowledge?: string;
}

// Minijuego 4 del catalogo (Alquimia Conceptual): dos conceptos distantes
// (element_a, element_b) y un "enigma de fusion"; el estudiante elige, entre
// 3 opciones, cual es el puente logico correcto que los conecta.
//
// Con `check` (calificacion en el servidor) la solucion llega DESPUES de elegir.
export function AlquimiaConceptualGame({
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
  const options = gameData.bridge_options || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ correctIds: (string | number)[]; explanation: string | null } | null>(null);

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

  async function handleSelect(opt: BridgeOption) {
    if (locked) return;
    setSelectedId(opt.id);
    setError(null);
    if (!check) {
      finish(opt.is_correct === true);
      return;
    }
    setChecking(true);
    const verdict = await check({ selectedId: opt.id });
    setChecking(false);
    if (!verdict) {
      setSelectedId(null);
      setError(CHECK_ERROR);
      return;
    }
    setRevealed({ correctIds: idList(verdict.reveal?.correctIds), explanation: textOrNull(verdict.reveal?.explanation) ?? verdict.explanation ?? null });
    finish(verdict.correct);
  }

  const isCorrect = (o: BridgeOption) => (revealed ? revealed.correctIds.includes(o.id) : o.is_correct === true);
  const correct = options.find(isCorrect);
  const explanation = revealed ? revealed.explanation : gameData.unlocked_knowledge;

  return (
    <div className="space-y-4">
      {gameData.fusion_title && (
        <p className="text-primary-text text-xs font-semibold uppercase tracking-wide">
          ⚗️ {gameData.fusion_title}
        </p>
      )}

      <div className="flex items-center justify-center gap-3 bg-surface-2 rounded-lg p-4">
        <span className="px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/40 text-fg text-sm font-bold">
          {gameData.element_a}
        </span>
        <span className="text-2xl text-accent-text">→ ? →</span>
        <span className="px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/40 text-fg text-sm font-bold">
          {gameData.element_b}
        </span>
      </div>

      <p className="text-fg-muted text-sm">{gameData.alchemy_enigma}</p>

      <div className="space-y-2">
        {options.map((opt) => {
          const isSelected = selectedId === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => handleSelect(opt)}
              disabled={locked}
              className={
                'w-full text-left p-4 rounded-lg border-2 text-sm font-medium transition-all ' +
                (isSelected
                  ? finished === 'won'
                    ? 'bg-success/15 border-success text-fg'
                    : finished === 'lost'
                    ? 'bg-danger/15 border-danger text-fg'
                    : 'bg-primary/10 border-primary text-fg'
                  : finished !== null && isCorrect(opt)
                  ? 'bg-success/15 border-success text-fg'
                  : finished !== null
                  ? 'bg-surface-2 border-line-strong text-fg-muted'
                  : 'bg-surface-2 border-line-strong text-fg hover:border-primary')
              }
            >
              {opt.text}
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
          <p className="text-success font-bold">🎉 ¡Fusión exitosa!</p>
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-primary/10 border border-primary/40 p-4 rounded-lg">
          <p className="text-primary-text font-bold">El puente correcto era: "{correct?.text}"</p>
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}
    </div>
  );
}
