import { cn } from './cn';

export type ProgressTone = 'primary' | 'accent' | 'success';

const TONES: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  accent: 'bg-accent',
  success: 'bg-success',
};

// Barra de progreso con semantica real: un lector de pantalla anuncia "Progreso: 40 %". El valor se acota a 0..100.
export function ProgressBar({
  value,
  label,
  tone = 'primary',
  className,
}: {
  value: number;
  label: string;
  tone?: ProgressTone;
  className?: string;
}) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', TONES[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
