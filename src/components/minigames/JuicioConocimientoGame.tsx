'use client';
import { useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';

interface Paragraph {
  paragraph_id: number;
  text: string;
}

interface GameData {
  case_file: string;
  expert_testimony: Paragraph[];
  guilty_paragraph_id: number;
  verdict_explanation?: string;
  cross_examination_tip?: string;
}

// Minijuego 6 del catalogo (El Juicio al Conocimiento): un testimonio en
// parrafos numerados donde uno contiene un error conceptual sutil. El
// estudiante debe objetar (tocar) el parrafo correcto. Incluye una pista
// opcional, igual que El Descifrador.
export function JuicioConocimientoGame({
  gameData,
  disabled,
  onComplete,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
}) {
  const paragraphs = gameData.expert_testimony || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const [accusedId, setAccusedId] = useState<number | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  const [tipShown, setTipShown] = useState(false);

  const locked = disabled || finished !== null;

  function handleObject(p: Paragraph) {
    if (locked) return;
    setAccusedId(p.paragraph_id);
    if (p.paragraph_id === gameData.guilty_paragraph_id) {
      onCorrectAnswer();
      setFinished('won');
      onComplete(true);
    } else {
      onWrongAnswer();
      setFinished('lost');
      onComplete(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-amber-300 text-xs font-semibold uppercase tracking-wide">⚖️ El Juicio al Conocimiento</p>
      <p className="text-gray-300 text-sm">{gameData.case_file}</p>

      {gameData.cross_examination_tip && (
        <div>
          {!tipShown ? (
            <button
              onClick={() => setTipShown(true)}
              disabled={locked}
              className="px-3 py-1 rounded-lg bg-yellow-900/40 border border-yellow-700 text-yellow-300 text-xs disabled:opacity-40 hover:bg-yellow-900/60"
            >
              💡 Pista del fiscal
            </button>
          ) : (
            <p className="text-xs text-yellow-200 bg-yellow-900/20 border border-yellow-800 rounded-lg px-3 py-2">
              {gameData.cross_examination_tip}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        {paragraphs.map((p) => {
          const isAccused = accusedId === p.paragraph_id;
          const revealAsGuilty = finished !== null && p.paragraph_id === gameData.guilty_paragraph_id;
          return (
            <button
              key={p.paragraph_id}
              onClick={() => handleObject(p)}
              disabled={locked}
              className={
                'w-full text-left p-4 rounded-lg border-2 text-sm transition-all ' +
                (revealAsGuilty
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
              <span className="font-mono text-xs text-purple-300 mr-2">§{p.paragraph_id}</span>
              {p.text} {revealAsGuilty && '⚠️'}
            </button>
          );
        })}
      </div>

      {finished && (
        <div className={`p-4 rounded-lg border ${finished === 'won' ? 'bg-green-900 border-green-500' : 'bg-blue-900 border-blue-500'}`}>
          <p className={`font-bold ${finished === 'won' ? 'text-green-300' : 'text-blue-300'}`}>
            {finished === 'won' ? '🎉 ¡Objeción sostenida!' : `El fraude estaba en el párrafo §${gameData.guilty_paragraph_id}`}
          </p>
          {gameData.verdict_explanation && (
            <p className={`text-sm mt-1 ${finished === 'won' ? 'text-green-100' : 'text-blue-100'}`}>
              {gameData.verdict_explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
