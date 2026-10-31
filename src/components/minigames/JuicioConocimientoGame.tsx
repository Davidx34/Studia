'use client';
import { useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { CHECK_ERROR, textOrNull, type GameCheck } from './serverCheck';

interface Paragraph {
  paragraph_id: number;
  text: string;
}

interface GameData {
  case_file: string;
  expert_testimony: Paragraph[];
  // Solo en el modo del navegador: con calificacion en el servidor el parrafo culpable NO viaja.
  guilty_paragraph_id?: number;
  verdict_explanation?: string;
  cross_examination_tip?: string;
}

// Minijuego 6 del catalogo (El Juicio al Conocimiento): un testimonio en
// parrafos numerados donde uno contiene un error conceptual sutil. El
// estudiante debe objetar (tocar) el parrafo correcto. Incluye una pista
// opcional, igual que El Descifrador.
//
// Con `check` (calificacion en el servidor) la solucion llega DESPUES de objetar.
export function JuicioConocimientoGame({
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
  const paragraphs = gameData.expert_testimony || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const [accusedId, setAccusedId] = useState<number | null>(null);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  const [tipShown, setTipShown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ guiltyParagraphId: number | null; explanation: string | null } | null>(null);

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

  async function handleObject(p: Paragraph) {
    if (locked) return;
    setAccusedId(p.paragraph_id);
    setError(null);
    if (!check) {
      finish(p.paragraph_id === gameData.guilty_paragraph_id);
      return;
    }
    setChecking(true);
    const verdict = await check({ selectedParagraphId: p.paragraph_id });
    setChecking(false);
    if (!verdict) {
      setAccusedId(null);
      setError(CHECK_ERROR);
      return;
    }
    const g = verdict.reveal?.guiltyParagraphId;
    setRevealed({ guiltyParagraphId: typeof g === 'number' ? g : null, explanation: textOrNull(verdict.reveal?.explanation) ?? verdict.explanation ?? null });
    finish(verdict.correct);
  }

  const guiltyId = revealed ? revealed.guiltyParagraphId : (gameData.guilty_paragraph_id ?? null);
  const explanation = revealed ? revealed.explanation : gameData.verdict_explanation;

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
          const revealAsGuilty = finished !== null && guiltyId !== null && p.paragraph_id === guiltyId;
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
                    : finished === 'lost'
                    ? 'bg-danger/15 border-danger text-fg'
                    : 'bg-primary/10 border-primary text-fg'
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

      {checking && <p className="text-fg-muted text-sm" aria-live="polite">Comprobando…</p>}
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {finished && (
        <div className={`p-4 rounded-lg border ${finished === 'won' ? 'bg-success/10 border-success' : 'bg-primary/10 border-primary/40'}`}>
          <p className={`font-bold ${finished === 'won' ? 'text-success' : 'text-primary-text'}`}>
            {finished === 'won' ? '🎉 ¡Objeción sostenida!' : `El fraude estaba en el párrafo §${guiltyId}`}
          </p>
          {explanation && <p className="text-sm mt-1 text-fg">{explanation}</p>}
        </div>
      )}
    </div>
  );
}
