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
        <p className="text-purple-300 text-xs font-semibold uppercase tracking-wide">
          ⚗️ {gameData.fusion_title}
        </p>
      )}

      <div className="flex items-center justify-center gap-3 bg-gray-700 rounded-lg p-4">
        <span className="px-3 py-1.5 rounded-lg bg-blue-900 border border-blue-600 text-blue-100 text-sm font-bold">
          {gameData.element_a}
        </span>
        <span className="text-2xl text-yellow-300">→ ? →</span>
        <span className="px-3 py-1.5 rounded-lg bg-pink-900 border border-pink-600 text-pink-100 text-sm font-bold">
          {gameData.element_b}
        </span>
      </div>

      <p className="text-gray-300 text-sm">{gameData.alchemy_enigma}</p>

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
                    ? 'bg-green-700 border-green-400 text-white'
                    : 'bg-red-700 border-red-400 text-white'
                  : finished !== null && opt.is_correct
                  ? 'bg-green-700 border-green-400 text-white'
                  : finished !== null
                  ? 'bg-gray-800 border-gray-700 text-gray-400'
                  : 'bg-gray-700 border-gray-600 text-gray-100 hover:border-purple-400')
              }
            >
              {opt.text}
            </button>
          );
        })}
      </div>

      {finished === 'won' && (
        <div className="bg-green-900 border border-green-500 p-4 rounded-lg">
          <p className="text-green-300 font-bold">🎉 ¡Fusión exitosa!</p>
          {gameData.unlocked_knowledge && (
            <p className="text-green-100 text-sm mt-1">{gameData.unlocked_knowledge}</p>
          )}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-blue-900 border border-blue-500 p-4 rounded-lg">
          <p className="text-blue-300 font-bold">El puente correcto era: "{correct?.text}"</p>
          {gameData.unlocked_knowledge && (
            <p className="text-blue-100 text-sm mt-1">{gameData.unlocked_knowledge}</p>
          )}
        </div>
      )}
    </div>
  );
}
