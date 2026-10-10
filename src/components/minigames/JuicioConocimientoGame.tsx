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
      <p className="text-accent-text text-xs font-semibold uppercase tracking-wide">⚖️ El Juicio al Conocimiento</p>
      <p className="text-fg-muted text-sm">{gameData.case_file}</p>

      {gameData.cross_examination_tip && (
        <div>
          {!tipShown ? (
            <button
              onClick={() => setTipShown(true)}
              disabled={locked}
              className="px-3 py-1 rounded-lg bg-accent/15 border border-accent/50 text-accent-text text-xs disabled:opacity-40 hover:bg-accent/25"
            >
              💡 Pista del fiscal
            </button>
          ) : (
            <p className="text-xs text-fg bg-accent/10 border border-accent/40 rounded-lg px-3 py-2">
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
                  ? 'bg-danger/15 border-danger text-fg'
                  : isAccused
                  ? finished === 'won'
                    ? 'bg-success/15 border-success text-fg'
                    : 'bg-danger/15 border-danger text-fg'
                  : finished !== null
                  ? 'bg-surface-2 border-line-strong text-fg-muted'
                  : 'bg-surface-2 border-line-strong text-fg hover:border-primary')
              }
            >
              <span className="font-mono text-xs text-primary-text mr-2">§{p.paragraph_id}</span>
              {p.text} {revealAsGuilty && '⚠️'}
            </button>
          );
        })}
      </div>

      {finished && (
        <div className={`p-4 rounded-lg border ${finished === 'won' ? 'bg-success/10 border-success' : 'bg-primary/10 border-primary/40'}`}>
          <p className={`font-bold ${finished === 'won' ? 'text-success' : 'text-primary-text'}`}>
            {finished === 'won' ? '🎉 ¡Objeción sostenida!' : `El fraude estaba en el párrafo §${gameData.guilty_paragraph_id}`}
          </p>
          {gameData.verdict_explanation && (
            <p className={`text-sm mt-1 ${finished === 'won' ? 'text-fg' : 'text-fg'}`}>
              {gameData.verdict_explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
