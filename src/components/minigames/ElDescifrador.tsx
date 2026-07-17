'use client';
import { useMemo, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';

interface GameData {
  word_to_guess: string;
  initial_clue: string;
  hints: string[];
  pedagogical_feedback?: string;
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

export function ElDescifrador({
  gameData,
  disabled,
  onComplete,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
}) {
  const word = gameData.word_to_guess || '';
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);

  const [guessed, setGuessed] = useState<Set<string>>(new Set());
  const [wrongCount, setWrongCount] = useState(0);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [finished, setFinished] = useState<'won' | 'lost' | null>(null);

  // Letras unicas normalizadas que hay que adivinar (sin contar espacios/guiones).
  const targetLetters = useMemo(
    () => new Set(word.split('').map(letterKey).filter((c) => /[A-ZÑ]/.test(c))),
    [word]
  );

  const locked = disabled || finished !== null;

  function handleLetterClick(letter: string) {
    if (locked) return;
    const norm = letterKey(letter);
    if (guessed.has(norm)) return;

    const nextGuessed = new Set(guessed);
    nextGuessed.add(norm);
    setGuessed(nextGuessed);

    if (targetLetters.has(norm)) {
      onCorrectAnswer();
      const allFound = [...targetLetters].every((l) => nextGuessed.has(l));
      if (allFound) {
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
  }

  function handleHint() {
    if (locked || hintsRevealed >= gameData.hints.length) return;
    setHintsRevealed((h) => h + 1);
  }

  const displayWord = word
    .split('')
    .map((ch) => {
      if (!/[a-zA-ZÑñ]/.test(ch)) return ch; // espacios/guiones se muestran tal cual
      return finished === 'lost' || guessed.has(letterKey(ch)) ? ch : '_';
    });

  return (
    <div className="space-y-4">
      <p className="text-gray-300 text-sm">{gameData.initial_clue}</p>

      <div className="bg-gray-700 rounded-lg p-5 text-center">
        <div className="text-3xl font-mono tracking-[0.3em] text-white">
          {displayWord.map((ch, i) => (
            <span key={i} className={ch === '_' ? 'text-purple-400' : 'text-white'}>
              {ch}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>❌ {wrongCount}/{MAX_WRONG} intentos fallidos</span>
        <button
          onClick={handleHint}
          disabled={locked || hintsRevealed >= gameData.hints.length}
          className="px-3 py-1 rounded-lg bg-yellow-900/40 border border-yellow-700 text-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-yellow-900/60"
        >
          💡 Pista ({hintsRevealed}/{gameData.hints.length})
        </button>
      </div>

      {hintsRevealed > 0 && !finished && (
        <div className="space-y-1">
          {gameData.hints.slice(0, hintsRevealed).map((h, i) => (
            <p key={i} className="text-xs text-yellow-200 bg-yellow-900/20 border border-yellow-800 rounded-lg px-3 py-2">
              Pista {i + 1}: {h}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5">
        {ALPHABET.map((letter) => {
          const norm = letterKey(letter);
          const used = guessed.has(norm);
          const isHit = used && targetLetters.has(norm);
          const isMiss = used && !targetLetters.has(norm);
          return (
            <button
              key={letter}
              onClick={() => handleLetterClick(letter)}
              disabled={locked || used}
              className={
                'aspect-square rounded-lg text-sm font-bold border-2 transition-all ' +
                (isHit
                  ? 'bg-green-700 border-green-400 text-white'
                  : isMiss
                  ? 'bg-red-900 border-red-700 text-red-300'
                  : 'bg-gray-800 border-gray-700 text-gray-200 hover:border-purple-400 disabled:opacity-30')
              }
            >
              {letter}
            </button>
          );
        })}
      </div>

      {finished === 'won' && (
        <div className="bg-green-900 border border-green-500 p-4 rounded-lg">
          <p className="text-green-300 font-bold">🎉 ¡Descifraste "{word}"!</p>
          {gameData.pedagogical_feedback && (
            <p className="text-green-100 text-sm mt-1">{gameData.pedagogical_feedback}</p>
          )}
        </div>
      )}

      {finished === 'lost' && (
        <div className="bg-blue-900 border border-blue-500 p-4 rounded-lg">
          <p className="text-blue-300 font-bold">La palabra era: {word}</p>
          {gameData.pedagogical_feedback && (
            <p className="text-blue-100 text-sm mt-1">{gameData.pedagogical_feedback}</p>
          )}
        </div>
      )}
    </div>
  );
}
