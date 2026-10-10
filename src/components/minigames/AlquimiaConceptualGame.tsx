'use client';
import { useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';

interface BridgeOption {
  id: string;
  text: string;
  is_correct: boolean;
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
export function AlquimiaConceptualGame({
  gameData,
  disabled,
  onComplete,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
}) {
  const options = gameData.bridge_options || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);

  const locked = disabled || finished !== null;

  function handleSelect(opt: BridgeOption) {
    if (locked) return;
    setSelectedId(opt.id);
    if (opt.is_correct) {
      onCorrectAnswer();
      setFinished('won');
      onComplete(true);
    } else {
      onWrongAnswer();
      setFinished('lost');
      onComplete(false);
    }
  }

  const correct = options.find((o) => o.is_correct);

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
                    : 'bg-danger/15 border-danger text-fg'
                  : finished !== null && opt.is_correct
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

      {finished === 'won' && (
        <div className="bg-success/10 border border-success p-4 rounded-lg">
          <p className="text-success font-bold">🎉 ¡Fusión exitosa!</p>
          {gameData.unlocked_knowledge && (
            <p className="text-fg text-sm mt-1">{gameData.unlocked_knowledge}</p>
          )}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-primary/10 border border-primary/40 p-4 rounded-lg">
          <p className="text-primary-text font-bold">El puente correcto era: "{correct?.text}"</p>
          {gameData.unlocked_knowledge && (
            <p className="text-fg text-sm mt-1">{gameData.unlocked_knowledge}</p>
          )}
        </div>
      )}
    </div>
  );
}
