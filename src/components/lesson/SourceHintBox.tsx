import { BookOpenText } from 'lucide-react';
import { MathText } from '@/components/MathText';
import type { SourceHint } from '@/lib/grading/sourceHint';

// Bajo la explicacion de una pregunta fallada: de que parte del material sale lo que faltaba. Es una pista aproximada,
// por eso dice "probablemente" y nombra el material y la seccion en vez de presentarse como cita exacta.
export function SourceHintBox({ source }: { source: SourceHint | null | undefined }) {
  if (!source) return null;
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4" role="note" aria-label="Dónde repasarlo en tu material">
      <p className="flex items-center gap-2 text-sm font-semibold text-fg">
        <BookOpenText className="w-4 h-4 text-primary-text flex-shrink-0" aria-hidden="true" />
        Repasa en tu material
      </p>
      <p className="mt-1 text-xs text-fg-muted">
        Probablemente en: <span className="font-medium text-fg">{source.material}</span>
        {source.section ? ` · ${source.section}` : ''}
      </p>
      <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm text-fg-muted">
        <MathText content={source.excerpt} />
      </blockquote>
    </div>
  );
}
