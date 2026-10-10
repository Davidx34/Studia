import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  // Solo cuando TODA la tarjeta es clicable o se puede enfocar: da respuesta visual al pasar el cursor.
  interactive?: boolean;
}

export function Card({ interactive = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-surface text-fg shadow-card',
        interactive && 'transition-[border-color,transform] duration-200 motion-reduce:transition-none hover:border-line-strong hover:-translate-y-0.5 motion-reduce:hover:translate-y-0',
        className
      )}
      {...rest}
    />
  );
}

export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'success' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-fg-muted border-line',
  primary: 'bg-primary/15 text-primary-text border-primary/30',
  accent: 'bg-accent/15 text-accent-text border-accent/30',
  success: 'bg-success/15 text-success border-success/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
};

// El color nunca es el unico mensaje: la etiqueta siempre lleva texto.
export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium', TONES[tone], className)}
      {...rest}
    />
  );
}
