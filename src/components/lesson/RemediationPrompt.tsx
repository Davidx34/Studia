'use client';
import { TonitoCharacter } from '@/components/tonito/TonitoCharacter';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

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
    <div className="max-w-2xl mx-auto px-4 py-6 sm:p-8">
      <Card className="p-6 sm:p-8 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <TonitoCharacter mood="thinking" animation="idle" gradient={['#6C5CE7', '#00D2D3']} size={100} />
          <h1 className="text-xl font-bold text-fg">¡Buen trabajo en este módulo!</h1>
          <p className="text-fg-muted text-sm">Vi que te costó un poco con estos conceptos:</p>
        </div>

        <ul className="space-y-2">
          {weakConcepts.map((c) => (
            <li key={c.tag} className="flex items-center justify-between bg-surface-2 rounded-xl px-4 py-2.5">
              <span className="text-fg text-sm font-medium">{formatConceptLabel(c.tag)}</span>
              <span className="text-accent-text text-sm font-mono">{c.accuracy}%</span>
            </li>
          ))}
        </ul>

        <p className="text-fg-muted text-sm text-center">
          ¿Hacemos un repaso rápido de esto? No te llevará más de 5 minutos, y ganas XP extra. 🎁
        </p>

        <div className="flex gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={onSkip} disabled={loading}>
            No, continuar
          </Button>
          <Button size="lg" className="flex-1" onClick={onAccept} loading={loading}>
            {loading ? 'Preparando...' : 'Sí, ayúdame'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
