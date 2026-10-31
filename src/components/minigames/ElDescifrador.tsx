'use client';
import { useMemo, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { CHECK_ERROR, idList, textOrNull, type GameCheck } from './serverCheck';

interface GameData {
  initial_clue: string;
  pedagogical_feedback?: string;
  // Solo en el modo del navegador: con calificacion en el servidor la palabra y las pistas NO viajan.
  word_to_guess?: string;
  hints?: string[];
  // Solo con calificacion en el servidor: la palabra enmascarada (null = letra oculta; lo demas se muestra tal cual) y cuantas pistas hay (se piden de a una).
  mask?: (string | null)[];
  hint_count?: number;
}

const MAX_WRONG = 6;
const ALPHABET = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split('');

// A diferencia de normalizeAnswer() (pensada para texto libre donde Ñ y N deben
// matchear), aca Ñ es una letra distinta de N — "AÑO" y "ANO" no son la misma
// palabra. Por eso se especial-casea antes de tirar los acentos por si acaso
// Cohere manda una vocal acentuada pese a la regla del prompt.
function letterKey(ch: string): string {
  const upper = ch.toUpperCase();
  if (upper === 'Ñ') return 'Ñ';
  return upper.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Con `check` (calificacion en el servidor) la palabra NO esta en el navegador: cada letra es un sondeo (el servidor dice en que posiciones aparece), las pistas se piden de a una
// y, al terminar (palabra completa o 6 fallos), se manda el conjunto de letras jugadas para que el servidor cierre la pregunta y revele la palabra.
export function ElDescifrador({
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
  const word = gameData.word_to_guess || '';
  const mask = gameData.mask || [];
  const hintTotal = check ? (gameData.hint_count ?? 0) : (gameData.hints?.length ?? 0);
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const [guessed, setGuessed] = useState<Set<string>>(new Set());
  const [wrongCount, setWrongCount] = useState(0);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);
  // Servidor: lo que va descubriendo (posicion -> caracter), las letras acertadas, las pistas ya pedidas y lo que se revela al cerrar.
  const [found, setFound] = useState<Record<number, string>>({});
  const [hits, setHits] = useState<Set<string>>(new Set());
  const [hintTexts, setHintTexts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ word: string; explanation: string | null } | null>(null);

  // Letras unicas normalizadas que hay que adivinar (sin contar espacios/guiones). Solo en el modo del navegador.
  const targetLetters = useMemo(
    () => new Set(word.split('').map(letterKey).filter((c) => /[A-ZÑ]/.test(c))),
    [word]
  );

  const locked = disabled || finished !== null || busy;
  const allFound = check ? mask.length > 0 && mask.every((m, i) => m !== null || found[i] !== undefined) : false;
  const gameOver = allFound || wrongCount >= MAX_WRONG;

  // Cierra la pregunta en el servidor con las letras que se probaron.
  async function finalize(played: Set<string>) {
    setError(null);
    setBusy(true);
    const verdict = await check!({ letters: Array.from(played) });
    setBusy(false);
    if (!verdict) {
      setError(CHECK_ERROR);
      return;
    }
    setRevealed({ word: textOrNull(verdict.reveal?.word) ?? '', explanation: textOrNull(verdict.reveal?.explanation) ?? verdict.explanation ?? null });
    if (verdict.correct) {
      setFinished('won');
      onComplete(true);
    } else {
      setFinished('lost');
      onComplete(false);
    }
  }

  async function handleLetterClick(letter: string) {
    if (locked) return;
    const norm = letterKey(letter);
    if (guessed.has(norm)) return;

    if (!check) {
      const nextGuessed = new Set(guessed);
      nextGuessed.add(norm);
      setGuessed(nextGuessed);

      if (targetLetters.has(norm)) {
        onCorrectAnswer();
        const everyFound = Array.from(targetLetters).every((l) => nextGuessed.has(l));
        if (everyFound) {
          setFinished('won');
          onComplete(true);
        }
      } else {
        onWrongAnswer();
        const nextWrong = wrongCount + 1;
        setWrongCount(nextWrong);
        if (nextWrong >= MAX_WRONG) {
          setFinished('lost');
          onComplete(false);
        }
      }
      return;
    }

    setError(null);
    setBusy(true);
    const probe = await check({ probe: { letter: norm } });
    setBusy(false);
    if (!probe) {
      setError(CHECK_ERROR);
      return;
    }
    const nextGuessed = new Set(guessed);
    nextGuessed.add(norm);
    setGuessed(nextGuessed);

    let nextFound = found;
    let nextWrong = wrongCount;
    if (probe.correct) {
      onCorrectAnswer();
      setHits(new Set(hits).add(norm));
      const positions = idList(probe.detail?.positions);
      const chars = idList(probe.detail?.chars);
      nextFound = { ...found };
      positions.forEach((pos, i) => {
        if (typeof pos === 'number' && typeof chars[i] === 'string') nextFound[pos] = chars[i] as string;
      });
      setFound(nextFound);
    } else {
      onWrongAnswer();
      nextWrong = wrongCount + 1;
      setWrongCount(nextWrong);
    }
    const done = mask.every((m, i) => m !== null || nextFound[i] !== undefined) || nextWrong >= MAX_WRONG;
    if (done) await finalize(nextGuessed);
  }

  async function handleHint() {
    if (locked || hintsRevealed >= hintTotal) return;
    if (!check) {
      setHintsRevealed((h) => h + 1);
      return;
    }
    setError(null);
    setBusy(true);
    const probe = await check({ probe: { hint: hintsRevealed } });
    setBusy(false);
    const text = textOrNull(probe?.detail?.hint);
    if (!probe || !text) {
      setError(CHECK_ERROR);
      return;
    }
    setHintTexts((t) => [...t, text]);
    setHintsRevealed((h) => h + 1);
  }

  const shownWord = revealed && finished === 'lost' ? revealed.word : word;
  const displayWord = check
    ? (revealed && finished === 'lost' ? revealed.word.split('') : mask.map((m, i) => (m !== null ? m : (found[i] ?? '_'))))
    : word.split('').map((ch) => {
        if (!/[a-zA-ZÑñ]/.test(ch)) return ch; // espacios/guiones se muestran tal cual
        return finished === 'lost' || guessed.has(letterKey(ch)) ? ch : '_';
      });
  const hintsShown = check ? hintTexts : (gameData.hints ?? []).slice(0, hintsRevealed);
  const explanation = revealed ? revealed.explanation : gameData.pedagogical_feedback;

  return (
    <div className="space-y-4">
      <p className="text-fg-muted text-sm">{gameData.initial_clue}</p>

      <div className="bg-surface-2 rounded-lg p-5 text-center">
        <div className="text-3xl font-mono tracking-[0.3em] text-fg">
          {displayWord.map((ch, i) => (
            <span key={i} className={ch === '_' ? 'text-primary-text' : 'text-fg'}>
              {ch}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>❌ {wrongCount}/{MAX_WRONG} intentos fallidos</span>
        <button
          onClick={handleHint}
          disabled={locked || hintsRevealed >= hintTotal}
          className="px-3 py-1 rounded-lg bg-accent/15 border border-accent/50 text-accent-text disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/25"
        >
          💡 Pista ({hintsRevealed}/{hintTotal})
        </button>
      </div>

      {hintsShown.length > 0 && !finished && (
        <div className="space-y-1">
          {hintsShown.map((h, i) => (
            <p key={i} className="text-xs text-fg bg-accent/10 border border-accent/40 rounded-lg px-3 py-2">
              Pista {i + 1}: {h}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5">
        {ALPHABET.map((letter) => {
          const norm = letterKey(letter);
          const used = guessed.has(norm);
          const hit = check ? hits.has(norm) : targetLetters.has(norm);
          const isHit = used && hit;
          const isMiss = used && !hit;
          return (
            <button
              key={letter}
              onClick={() => handleLetterClick(letter)}
              disabled={locked || used}
              aria-label={used ? `${letter}: ${isHit ? 'acierto' : 'fallo'}` : letter}
              className={
                'aspect-square rounded-lg text-sm font-bold border-2 transition-all ' +
                (isHit
                  ? 'bg-success/15 border-success text-fg'
                  : isMiss
                  ? 'bg-danger/10 border-danger text-danger'
                  : 'bg-surface-2 border-line-strong text-fg hover:border-primary disabled:opacity-30')
              }
            >
              {letter}
            </button>
          );
        })}
      </div>

      {busy && <p className="text-fg-muted text-sm" aria-live="polite">Comprobando…</p>}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
          {check && gameOver && finished === null && (
            <button onClick={() => finalize(guessed)} disabled={busy} className="px-3 py-2 rounded-lg bg-primary text-on-primary text-sm font-bold disabled:opacity-40">
              Reintentar
            </button>
          )}
        </div>
      )}

      {finished === 'won' && (
        <div className="bg-success/10 border border-success p-4 rounded-lg">
          <p className="text-success font-bold">🎉 ¡Descifraste "{shownWord || (revealed?.word ?? '')}"!</p>
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-primary/10 border border-primary/40 p-4 rounded-lg">
          <p className="text-primary-text font-bold">La palabra era: {shownWord}</p>
          {explanation && <p className="text-fg text-sm mt-1">{explanation}</p>}
        </div>
      )}
    </div>
  );
}
