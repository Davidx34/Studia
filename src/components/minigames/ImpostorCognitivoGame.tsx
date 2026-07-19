'use client';
import { useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';

interface Statement {
  id: number;
  text: string;
  is_impostor: boolean;
}

interface GameData {
  context?: string;
  statements: Statement[];
  exposicion_del_impostor?: string;
}

// Minijuego 2 del catalogo (El Impostor Cognitivo): tap-to-accuse, un solo
// intento — 2 afirmaciones verdaderas y 1 falsa ("el impostor"), el
// estudiante debe señalar cual es la falsa.
export function ImpostorCognitivoGame({
  gameData,
  disabled,
  onComplete,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
}) {
  const statements = gameData.statements || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const [accusedId, setAccusedId] = useState<number | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);

  const locked = disabled || finished !== null;

  function handleAccuse(st: Statement) {
    if (locked) return;
    setAccusedId(st.id);
    if (st.is_impostor) {
      onCorrectAnswer();
      setFinished('won');
      onComplete(true);
    } else {
      onWrongAnswer();
      setFinished('lost');
      onComplete(false);
    }
  }

  const impostor = statements.find((s) => s.is_impostor);

  return (
    <div className="space-y-4">
      {gameData.context && <p className="text-gray-300 text-sm">{gameData.context}</p>}
      <p className="text-purple-300 text-xs font-semibold uppercase tracking-wide">
        🕵️ ¿Cuál de estas afirmaciones es el impostor (falsa)?
      </p>

      <div className="space-y-2">
        {statements.map((st) => {
          const isAccused = accusedId === st.id;
          const revealAsImpostor = finished !== null && st.is_impostor;
          return (
            <button
              key={st.id}
              onClick={() => handleAccuse(st)}
              disabled={locked}
              className={
                'w-full text-left p-4 rounded-lg border-2 text-sm font-medium transition-all ' +
                (revealAsImpostor
                  ? 'bg-red-700 border-red-400 text-white'
                  : isAccused
                  ? finished === 'won'
                    ? 'bg-green-700 border-green-400 text-white'
                    : 'bg-red-700 border-red-400 text-white'
                  : finished !== null
                  ? 'bg-gray-800 border-gray-700 text-gray-400'
                  : 'bg-gray-700 border-gray-600 text-gray-100 hover:border-purple-400')
              }
            >
              {st.text} {revealAsImpostor && '🎭'}
            </button>
          );
        })}
      </div>

      {finished === 'won' && (
        <div className="bg-green-900 border border-green-500 p-4 rounded-lg">
          <p className="text-green-300 font-bold">🎉 ¡Atrapaste al impostor!</p>
          {gameData.exposicion_del_impostor && (
            <p className="text-green-100 text-sm mt-1">{gameData.exposicion_del_impostor}</p>
          )}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-blue-900 border border-blue-500 p-4 rounded-lg">
          <p className="text-blue-300 font-bold">
            El impostor era: "{impostor?.text}"
          </p>
          {gameData.exposicion_del_impostor && (
            <p className="text-blue-100 text-sm mt-1">{gameData.exposicion_del_impostor}</p>
          )}
        </div>
      )}
    </div>
  );
}
