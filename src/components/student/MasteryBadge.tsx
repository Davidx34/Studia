import { Award, RotateCcw, TrendingUp } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Card';
import { MASTERY_LABELS, masteryDetail, type ModuleMastery } from '@/lib/mastery/mastery';

const TONE: Record<string, BadgeTone> = { mastered: 'success', needs_review: 'accent', in_progress: 'neutral' };
const ICON = { mastered: Award, needs_review: RotateCcw, in_progress: TrendingUp } as const;

// Dominio de un modulo en su tarjeta. El estado se dice con icono, texto Y el conteo real; nunca solo con color.
// Un modulo sin respuestas no muestra nada (la tarjeta ya dice "Disponible", "Bloqueado"...).
export function MasteryBadge({ mastery }: { mastery: ModuleMastery }) {
  if (mastery.state === 'not_started') return null;
  const Icon = ICON[mastery.state];
  return (
    <div className="mt-2 space-y-1">
      <Badge tone={TONE[mastery.state]}>
        <Icon aria-hidden="true" className="w-3.5 h-3.5" /> {MASTERY_LABELS[mastery.state]}
      </Badge>
      <p className="text-xs text-fg-muted">{masteryDetail(mastery)}</p>
    </div>
  );
}
