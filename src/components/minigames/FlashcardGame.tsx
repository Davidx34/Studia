'use client';
import { useMemo, useRef, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';

interface Pair {
  id: number;
  card1: string;
  card2: string;
}

interface GameData {
  theme?: string;
  pairs: Pair[];
  pedagogical_feedback?: string;
}

interface Card {
  pairId: number;
  text: string;
}

function shuffledIndices(n: number): number[] {
  const idxs = Array.from({ length: n }, (_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  return idxs;
}

function movesLabel(moves: number): string {
  if (moves <= 12) return '¡Memoria excelente! 🧠✨';
  if (moves <= 20) return '¡Buena memoria! 👍';
  return 'Memoria en desarrollo — ¡sigue practicando! 💪';
}

export function FlashcardGame({
  gameData,
  disabled,
  onComplete,
}: {
  gameData: GameData;
  disabled: boolean;
  onComplete: (correct: boolean) => void;
}) {
  const pairs = gameData.pairs || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);
  const showMessage = useTonitoStore((s) => s.showMessage);

  const cards: Card[] = useMemo(() => {
    const flat: Card[] = [];
    for (const p of pairs) {
      flat.push({ pairId: p.id, text: p.card1 });
      flat.push({ pairId: p.id, text: p.card2 });
    }
    return flat;
  }, [pairs]);

  const order = useMemo(() => shuffledIndices(cards.length), [cards]);

  const [flipped, setFlipped] = useState<number[]>([]); // indices (en `cards`) boca arriba, max 2
  const [matched, setMatched] = useState<Set<number>>(new Set()); // pairIds resueltos
  const [particlesAt, setParticlesAt] = useState<number | null>(null); // pairId con efecto
  const [moves, setMoves] = useState(0);
  const [resolving, setResolving] = useState(false); // true mientras se muestran 2 cartas que no matchean
  const [finished, setFinished] = useState(false);

  const milestonesFired = useRef<Set<string>>(new Set());
  const locked = disabled || finished;

  function fireMilestone(key: string, msg: string) {
    if (milestonesFired.current.has(key)) return;
    milestonesFired.current.add(key);
    showMessage(msg, 2500);
  }

  function handleFlip(idx: number) {
    if (locked || resolving) return;
    if (flipped.includes(idx)) return;
    if (matched.has(cards[idx].pairId)) return;
    if (flipped.length === 2) return;

    const nextFlipped = [...flipped, idx];
    setFlipped(nextFlipped);

    if (nextFlipped.length === 2) {
      const [a, b] = nextFlipped;
      const isMatch = cards[a].pairId === cards[b].pairId;
      setMoves((m) => m + 1);

      if (isMatch) {
        onCorrectAnswer();
        const pairId = cards[a].pairId;
        setParticlesAt(pairId);
        setTimeout(() => setParticlesAt(null), 700);
        const nextMatched = new Set(matched);
        nextMatched.add(pairId);
        setMatched(nextMatched);
        setFlipped([]);

        const foundCount = nextMatched.size;
        if (foundCount === 1) fireMilestone('first', '¡Primer par encontrado! 🎉');
        else if (foundCount === Math.ceil(pairs.length / 2)) fireMilestone('half', '¡Vas a la mitad! 💪');
        else if (foundCount === pairs.length - 1) fireMilestone('almost', '¡Ya casi! Solo falta un par 🔥');

        if (foundCount === pairs.length) {
          setFinished(true);
          onComplete(true);
        }
      } else {
        onWrongAnswer();
        setResolving(true);
        setTimeout(() => {
          setFlipped([]);
          setResolving(false);
        }, 1000);
      }
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-gray-300 text-sm">Encuentra los pares relacionados. Toca dos tarjetas para compararlas.</p>

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>🔁 Movimientos: {moves}</span>
        <span>✓ Pares: {matched.size}/{pairs.length}</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {order.map((idx) => {
          const card = cards[idx];
          const isMatched = matched.has(card.pairId);
          const isFaceUp = flipped.includes(idx) || isMatched;
          return (
            <div key={idx} className="aspect-square [perspective:600px] relative">
              {particlesAt === card.pairId && isMatched && <CardParticles />}
              <button
                onClick={() => handleFlip(idx)}
                disabled={locked || isMatched || resolving}
                className="w-full h-full relative disabled:cursor-default"
                style={{
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.6s',
                  transform: isFaceUp ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  opacity: isMatched ? 0 : 1,
                  pointerEvents: isMatched ? 'none' : 'auto',
                }}
              >
                <div
                  className="absolute inset-0 rounded-lg bg-purple-800 border-2 border-purple-600 flex items-center justify-center text-2xl"
                  style={{ backfaceVisibility: 'hidden' }}
                >
                  ❓
                </div>
                <div
                  className="absolute inset-0 rounded-lg bg-blue-700 border-2 border-blue-400 flex items-center justify-center text-white text-[11px] font-medium text-center p-1 leading-tight"
                  style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                >
                  {card.text}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {finished && (
        <div className="bg-green-900 border border-green-500 p-4 rounded-lg">
          <p className="text-green-300 font-bold">🎉 ¡Encontraste todos los pares en {moves} movimientos!</p>
          <p className="text-green-200 text-sm mt-1">{movesLabel(moves)}</p>
          {gameData.pedagogical_feedback && (
            <p className="text-green-100 text-sm mt-1">{gameData.pedagogical_feedback}</p>
          )}
        </div>
      )}
    </div>
  );
}

function CardParticles() {
  const particles = useMemo(
    () =>
      Array.from({ length: 8 }).map((_, i) => ({
        id: i,
        angle: (360 / 8) * i,
        color: ['#10b981', '#a855f7', '#fde047', '#3b82f6'][i % 4],
      })),
    []
  );
  return (
    <div className="absolute inset-0 pointer-events-none z-10" style={{ overflow: 'visible' }}>
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute top-1/2 left-1/2 w-1.5 h-1.5 rounded-full animate-card-particle"
          style={{
            background: p.color,
            // @ts-ignore custom prop consumido por la animacion
            '--angle': `${p.angle}deg`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes card-particle {
          0% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(28px) scale(0); opacity: 0; }
        }
        .animate-card-particle { animation: card-particle 0.7s ease-out forwards; }
      `}</style>
    </div>
  );
}
