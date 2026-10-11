'use client';
import { useState, useRef, useLayoutEffect, useCallback, useEffect, useMemo } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { MathText } from '@/components/MathText';

interface Pair {
  term: string;
  def: string;
}

interface Line {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ok: boolean;
}

const MAX_ATTEMPTS = 3;

function shuffledIndices(n: number): number[] {
  const idxs = Array.from({ length: n }, (_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  return idxs;
}

export function LessonQuestionMatch({
  pairs,
  disabled,
  onComplete,
}: {
  pairs: Pair[];
  disabled: boolean;
  // `pairing[i]` = indice del par cuya definicion conecto el estudiante con el termino i (-1 = sin conectar).
  onComplete: (correct: boolean, pairing: number[]) => void;
}) {
  // shuffledDefs[posición] = índice original del par cuya definición se muestra ahí
  const shuffledDefs = useMemo(() => shuffledIndices(pairs.length), [pairs]);

  const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
  const [connections, setConnections] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);

  const locked = disabled || revealed;
  const allConnected = pairs.length > 0 && Object.keys(connections).length === pairs.length;
  const allCorrect = allConnected && pairs.every((_, termIdx) => shuffledDefs[connections[termIdx]] === termIdx);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const defRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const recomputeLines = useCallback(() => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    const next: Line[] = [];
    for (const [termIdxStr, defPos] of Object.entries(connections)) {
      const termIdx = Number(termIdxStr);
      const termEl = termRefs.current[termIdx];
      const defEl = defRefs.current[defPos];
      if (!termEl || !defEl) continue;
      const tb = termEl.getBoundingClientRect();
      const db = defEl.getBoundingClientRect();
      next.push({
        key: `${termIdx}-${defPos}`,
        x1: tb.right - box.left,
        y1: tb.top + tb.height / 2 - box.top,
        x2: db.left - box.left,
        y2: db.top + db.height / 2 - box.top,
        ok: checked ? shuffledDefs[defPos] === termIdx : true,
      });
    }
    setLines(next);
  }, [connections, checked, shuffledDefs]);

  useLayoutEffect(() => {
    recomputeLines();
  }, [recomputeLines]);

  useEffect(() => {
    window.addEventListener('resize', recomputeLines);
    return () => window.removeEventListener('resize', recomputeLines);
  }, [recomputeLines]);

  const handleTermClick = (termIdx: number) => {
    if (locked) return;
    setSelectedTerm((prev) => (prev === termIdx ? null : termIdx));
  };

  const handleDefClick = (defPos: number) => {
    if (locked || selectedTerm === null) return;
    setConnections((prev) => ({ ...prev, [selectedTerm]: defPos }));
    setSelectedTerm(null);
  };

  const userPairing = () => pairs.map((_, termIdx) => (connections[termIdx] === undefined ? -1 : shuffledDefs[connections[termIdx]]));

  const handleVerify = () => {
    setChecked(true);
    if (allCorrect) {
      onComplete(true, userPairing());
    }
  };

  const handleRetry = () => {
    // Conservar las conexiones correctas, solo pedir reconectar las incorrectas.
    setConnections((prev) => {
      const next: Record<number, number> = {};
      for (const [termIdxStr, defPos] of Object.entries(prev)) {
        const termIdx = Number(termIdxStr);
        if (shuffledDefs[defPos] === termIdx) next[termIdx] = defPos;
      }
      return next;
    });
    setChecked(false);
    setAttempts((a) => a + 1);
  };

  const handleReveal = () => {
    // Lo que el estudiante dejo conectado, ANTES de mostrarle la solucion.
    const given = userPairing();
    setRevealed(true);
    setChecked(true);
    const correctConnections: Record<number, number> = {};
    shuffledDefs.forEach((origIdx, defPos) => {
      correctConnections[origIdx] = defPos;
    });
    setConnections(correctConnections);
    onComplete(false, given);
  };

  const isTermCorrect = (termIdx: number) =>
    checked && connections[termIdx] !== undefined && shuffledDefs[connections[termIdx]] === termIdx;
  const isTermWrong = (termIdx: number) =>
    checked && connections[termIdx] !== undefined && shuffledDefs[connections[termIdx]] !== termIdx;
  const isDefUsedBy = (defPos: number) =>
    Object.entries(connections).find(([, dp]) => dp === defPos)?.[0];

  return (
    <div className="space-y-4">
      <p className="text-fg-muted text-sm">
        {locked
          ? allCorrect
            ? '¡Todas las conexiones son correctas!'
            : 'Así se conectan correctamente:'
          : 'Toca un concepto y luego su definición para conectarlos'}
      </p>

      <div ref={containerRef} className="relative grid grid-cols-2 gap-x-6 gap-y-3">
        <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%', zIndex: 1 }}>
          {lines.map((l) => (
            <line
              key={l.key}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke={!checked ? 'rgb(var(--c-primary))' : l.ok ? 'rgb(var(--c-success))' : 'rgb(var(--c-danger))'}
              strokeWidth={3}
              strokeLinecap="round"
              className="transition-all duration-300"
            />
          ))}
        </svg>

        <div className="space-y-3" style={{ position: 'relative', zIndex: 2 }}>
          {pairs.map((p, termIdx) => (
            <button
              key={termIdx}
              ref={(el) => { termRefs.current[termIdx] = el; }}
              onClick={() => handleTermClick(termIdx)}
              disabled={locked}
              aria-pressed={selectedTerm === termIdx}
              className={
                'w-full text-left p-3 rounded-lg text-sm font-medium border-2 transition-all ' +
                (isTermCorrect(termIdx)
                  ? 'bg-success/15 border-success text-fg'
                  : isTermWrong(termIdx)
                  ? 'bg-danger/15 border-danger text-fg'
                  : selectedTerm === termIdx
                  ? 'bg-primary border-accent text-on-primary scale-[1.03]'
                  : connections[termIdx] !== undefined
                  ? 'bg-primary/20 border-primary/60 text-fg'
                  : 'bg-surface-2 border-line-strong text-fg hover:border-primary')
              }
            >
              <span className="flex items-center justify-between gap-2">
                <MathText content={p.term} />
                {/* El resultado no depende solo del color: lleva icono y texto para lectores de pantalla. */}
                {isTermCorrect(termIdx) && (<><CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" aria-hidden="true" /><span className="sr-only">(conexion correcta)</span></>)}
                {isTermWrong(termIdx) && (<><XCircle className="h-4 w-4 flex-shrink-0 text-danger" aria-hidden="true" /><span className="sr-only">(conexion incorrecta)</span></>)}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-3" style={{ position: 'relative', zIndex: 2 }}>
          {shuffledDefs.map((origIdx, defPos) => {
            const usedByTerm = isDefUsedBy(defPos);
            const usedByTermIdx = usedByTerm !== undefined ? Number(usedByTerm) : null;
            return (
              <button
                key={defPos}
                ref={(el) => { defRefs.current[defPos] = el; }}
                onClick={() => handleDefClick(defPos)}
                disabled={locked}
                className={
                  'w-full text-left p-3 rounded-lg text-sm border-2 transition-all ' +
                  (usedByTermIdx !== null && isTermCorrect(usedByTermIdx)
                    ? 'bg-success/15 border-success text-fg'
                    : usedByTermIdx !== null && isTermWrong(usedByTermIdx)
                    ? 'bg-danger/15 border-danger text-fg'
                    : usedByTermIdx !== null
                    ? 'bg-primary/15 border-primary/40 text-fg'
                    : 'bg-primary/10 border-primary/30 text-fg hover:border-primary')
                }
              >
                <MathText content={pairs[origIdx].def} />
              </button>
            );
          })}
        </div>
      </div>

      {!locked && !checked && (
        <button
          onClick={handleVerify}
          disabled={!allConnected}
          className="w-full p-4 rounded-lg bg-primary text-on-primary font-bold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Verificar conexiones
        </button>
      )}

      {!locked && checked && !allCorrect && (
        <div className="flex gap-3">
          {attempts + 1 < MAX_ATTEMPTS ? (
            <button
              onClick={handleRetry}
              className="flex-1 p-4 rounded-lg bg-surface-2 border border-line text-fg font-bold hover:brightness-110"
            >
              Reintentar ({MAX_ATTEMPTS - attempts - 1} intentos restantes)
            </button>
          ) : (
            <button
              onClick={handleReveal}
              className="flex-1 p-4 rounded-lg bg-surface-2 border border-line text-fg font-bold hover:brightness-110"
            >
              Ver respuesta correcta
            </button>
          )}
        </div>
      )}

      {checked && allCorrect && <MiniConfetti />}
    </div>
  );
}

function MiniConfetti() {
  const particles = useMemo(
    () =>
      Array.from({ length: 16 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.3,
        color: ['#10b981', '#a855f7', '#fde047', '#3b82f6'][i % 4],
      })),
    []
  );
  return (
    <div className="relative h-0 pointer-events-none">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute top-0 w-2 h-2 rounded-full animate-mini-confetti"
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s` }}
        />
      ))}
      <style jsx>{`
        @keyframes mini-confetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(60px) rotate(360deg); opacity: 0; }
        }
        .animate-mini-confetti { animation: mini-confetti 0.9s ease-out forwards; }
      `}</style>
    </div>
  );
}
