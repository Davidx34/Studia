import { Award, Circle, RotateCcw, TrendingUp } from 'lucide-react';
import { MASTERY_LABELS, type MasteryCounts, type MasteryState } from '@/lib/mastery/mastery';

// Piezas compartidas por la vista del estudiante ("Tu dominio") y la del profesor ("Dominio").

export const MASTERY_ORDER: MasteryState[] = ['mastered', 'needs_review', 'in_progress', 'not_started'];

export const MASTERY_ICON = { mastered: Award, needs_review: RotateCcw, in_progress: TrendingUp, not_started: Circle } as const;

const SEGMENT: Record<MasteryState, string> = {
  mastered: 'bg-success',
  needs_review: 'bg-accent',
  in_progress: 'bg-primary/50',
  not_started: 'bg-surface-2',
};

export function describeCounts(c: MasteryCounts): string {
  return MASTERY_ORDER.map((s) => `${c[s]} ${MASTERY_LABELS[s].toLowerCase()}`).join(', ');
}

// Barra segmentada. Para un lector de pantalla es UNA imagen con el conteo en texto; el color solo refuerza.
export function SegmentedBar({ counts, label }: { counts: MasteryCounts; label: string }) {
  return (
    <div role="img" aria-label={`${label}: ${describeCounts(counts)}`} className="flex h-2.5 w-full overflow-hidden rounded-full border border-line bg-surface-2">
      {MASTERY_ORDER.map((s) =>
        counts[s] > 0 ? <div key={s} className={SEGMENT[s]} style={{ width: `${(counts[s] / counts.total) * 100}%` }} /> : null
      )}
    </div>
  );
}
