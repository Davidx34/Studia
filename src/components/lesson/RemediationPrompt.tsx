'use client';
import { TonitoCharacter } from '@/components/tonito/TonitoCharacter';

interface WeakConcept {
  tag: string;
  accuracy: number;
}

function formatConceptLabel(tag: string): string {
  const s = tag.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function RemediationPrompt({
  weakConcepts,
  loading,
  onAccept,
  onSkip,
}: {
  weakConcepts: WeakConcept[];
  loading: boolean;
  onAccept: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="bg-gray-800 rounded-xl p-8 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <TonitoCharacter mood="thinking" animation="idle" gradient={['#6C5CE7', '#00D2D3']} size={100} />
          <h1 className="text-xl font-bold text-white">¡Buen trabajo en este módulo!</h1>
          <p className="text-gray-300 text-sm">
            Vi que te costó un poco con estos conceptos:
          </p>
        </div>

        <ul className="space-y-2">
          {weakConcepts.map((c) => (
            <li
              key={c.tag}
              className="flex items-center justify-between bg-gray-700 rounded-lg px-4 py-2.5"
            >
              <span className="text-white text-sm font-medium">{formatConceptLabel(c.tag)}</span>
              <span className="text-amber-300 text-sm font-mono">{c.accuracy}%</span>
            </li>
          ))}
        </ul>

        <p className="text-gray-300 text-sm text-center">
          ¿Hacemos un repaso rápido de esto? No te llevará más de 5 minutos, y ganas XP extra. 🎁
        </p>

        <div className="flex gap-3">
          <button
            onClick={onSkip}
            disabled={loading}
            className="flex-1 p-4 rounded-lg bg-gray-700 text-white font-bold hover:bg-gray-600 disabled:opacity-50"
          >
            No, continuar
          </button>
          <button
            onClick={onAccept}
            disabled={loading}
            className="flex-1 p-4 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Preparando...
              </>
            ) : (
              'Sí, ayúdame'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
