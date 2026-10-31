'use client';
import { useMemo, useRef, useState } from 'react';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { CHECK_ERROR, type GameCheck } from './serverCheck';

interface Pair {
  id: number;
  card1: string;
  card2: string;
}

interface GameData {
  theme?: string;
  pedagogical_feedback?: string;
  // Solo en el modo del navegador: con calificacion en el servidor las parejas NO viajan.
  pairs?: Pair[];
  // Solo con calificacion en el servidor: las cartas con una clave y su texto, en un orden que no delata la pareja.
  cards?: { key: number; text: string }[];
}

interface Card {
  // Servidor: clave de la carta. Navegador: no se usa (la pareja esta en pairId).
  key: number;
  pairId?: number;
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

// Con `check` (calificacion en el servidor) las parejas NO estan en el navegador: cada par que se voltea es un sondeo ("¿coinciden estas dos?") y, al encontrar todos, se manda la
// lista de pares para cerrar la pregunta. Como en el juego de siempre, no se pierde: termina al encontrar el ultimo par.
export function FlashcardGame({
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
  const pairs = gameData.pairs || [];
  const onCorrectAnswer = useTonitoStore((s) => s.onCorrectAnswer);
  const onWrongAnswer = useTonitoStore((s) => s.onWrongAnswer);
  const showMessage = useTonitoStore((s) => s.showMessage);

  const cards: Card[] = useMemo(() => {
    if (gameData.cards) return gameData.cards.map((c) => ({ key: c.key, text: c.text }));
    const flat: Card[] = [];
    for (const p of pairs) {
      flat.push({ key: flat.length, pairId: p.id, text: p.card1 });
      flat.push({ key: flat.length, pairId: p.id, text: p.card2 });
    }
    return flat;
  }, [pairs, gameData.cards]);
  const totalPairs = cards.length / 2;

  const order = useMemo(() => shuffledIndices(cards.length), [cards]);

  const [flipped, setFlipped] = useState<number[]>([]); // indices (en `cards`) boca arriba, max 2
  const [matched, setMatched] = useState<Set<number>>(new Set()); // indices (en `cards`) de las cartas ya emparejadas
  const [matchList, setMatchList] = useState<[number, number][]>([]); // claves de los pares encontrados (servidor)
  const [particlesAt, setParticlesAt] = useState<number[]>([]); // indices con efecto
  const [moves, setMoves] = useState(0);
  const [resolving, setResolving] = useState(false); // true mientras se muestran 2 cartas que no matchean, o se espera al servidor
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const milestonesFired = useRef<Set<string>>(new Set());
  const locked = disabled || finished;

  function fireMilestone(key: string, msg: string) {
    if (milestonesFired.current.has(key)) return;
    milestonesFired.current.add(key);
    showMessage(msg, 2500);
  }

  // Un par encontrado: efecto, hitos y, si era el ultimo, fin (en el servidor, tras cerrar la pregunta).
  function pairFound(a: number, b: number, nextMatched: Set<number>) {
    onCorrectAnswer();
    setParticlesAt([a, b]);
    setTimeout(() => setParticlesAt([]), 700);
    setMatched(nextMatched);
    setFlipped([]);
    const foundCount = nextMatched.size / 2;
    if (foundCount === 1) fireMilestone('first', '¡Primer par encontrado! 🎉');
    else if (foundCount === Math.ceil(totalPairs / 2)) fireMilestone('half', '¡Vas a la mitad! 💪');
    else if (foundCount === totalPairs - 1) fireMilestone('almost', '¡Ya casi! Solo falta un par 🔥');
    return foundCount;
  }

  function mismatch() {
    onWrongAnswer();
    setResolving(true);
    setTimeout(() => {
      setFlipped([]);
      setResolving(false);
    }, 1000);
  }

  // Cierra la pregunta en el servidor con todos los pares encontrados.
  async function finalize(matches: [number, number][]) {
    setError(null);
    setResolving(true);
    const verdict = await check!({ matches });
    setResolving(false);
    if (!verdict || !verdict.correct) {
      setError(CHECK_ERROR);
      return;
    }
    setFinished(true);
    onComplete(true);
  }

  async function handleFlip(idx: number) {
    if (locked || resolving) return;
    if (flipped.includes(idx)) return;
    if (matched.has(idx)) return;
    if (flipped.length === 2) return;

    const nextFlipped = [...flipped, idx];
    setFlipped(nextFlipped);
    if (nextFlipped.length !== 2) return;

    const [a, b] = nextFlipped;

    if (!check) {
      const isMatch = cards[a].pairId === cards[b].pairId;
      setMoves((m) => m + 1);
      if (isMatch) {
        const nextMatched = new Set(matched);
        nextMatched.add(a);
        nextMatched.add(b);
        const foundCount = pairFound(a, b, nextMatched);
        if (foundCount === totalPairs) {
          setFinished(true);
          onComplete(true);
        }
      } else {
        mismatch();
      }
      return;
    }

    // Servidor: se espera su veredicto con las dos cartas boca arriba.
    setError(null);
    setResolving(true);
    const probe = await check({ probe: { a: cards[a].key, b: cards[b].key } });
    if (!probe) {
      setError(CHECK_ERROR);
      setTimeout(() => {
        setFlipped([]);
        setResolving(false);
      }, 600);
      return;
    }
    setMoves((m) => m + 1);
    if (probe.correct) {
      setResolving(false);
      const nextMatched = new Set(matched);
      nextMatched.add(a);
      nextMatched.add(b);
      const nextList: [number, number][] = [...matchList, [cards[a].key, cards[b].key]];
      setMatchList(nextList);
      const foundCount = pairFound(a, b, nextMatched);
      if (foundCount === totalPairs) await finalize(nextList);
    } else {
      mismatch();
    }
  }

  const allMatched = check ? cards.length > 0 && matched.size === cards.length : false;

  return (
    <div className="space-y-4">
      <p className="text-fg-muted text-sm">Encuentra los pares relacionados. Toca dos tarjetas para compararlas.</p>

      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>🔁 Movimientos: {moves}</span>
        <span>✓ Pares: {matched.size / 2}/{totalPairs}</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {order.map((idx) => {
          const card = cards[idx];
          const isMatched = matched.has(idx);
          const isFaceUp = flipped.includes(idx) || isMatched;
          return (
            <div key={idx} className="aspect-square [perspective:600px] relative">
              {particlesAt.includes(idx) && isMatched && <CardParticles />}
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
                  className="absolute inset-0 rounded-lg bg-primary/20 border-2 border-primary/60 flex items-center justify-center text-2xl"
                  style={{ backfaceVisibility: 'hidden' }}
                >
                  ❓
                </div>
                <div
                  className="absolute inset-0 rounded-lg bg-primary/15 border-2 border-primary/40 flex items-center justify-center text-fg text-[11px] font-medium text-center p-1 leading-tight"
                  style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                >
                  {card.text}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {check && resolving && flipped.length === 2 && <p className="text-fg-muted text-sm" aria-live="polite">Comprobando…</p>}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
          {check && allMatched && !finished && (
            <button onClick={() => finalize(matchList)} disabled={resolving} className="px-3 py-2 rounded-lg bg-primary text-on-primary text-sm font-bold disabled:opacity-40">
              Reintentar
            </button>
          )}
        </div>
      )}

      {finished && (
        <div className="bg-success/10 border border-success p-4 rounded-lg">
          <p className="text-success font-bold">🎉 ¡Encontraste todos los pares en {moves} movimientos!</p>
          <p className="text-fg text-sm mt-1">{movesLabel(moves)}</p>
          {gameData.pedagogical_feedback && (
            <p className="text-fg text-sm mt-1">{gameData.pedagogical_feedback}</p>
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
