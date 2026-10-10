import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:brightness-110',
  accent: 'bg-accent text-on-accent hover:brightness-105',
  secondary: 'bg-surface-2 text-fg border border-line hover:border-line-strong',
  ghost: 'bg-transparent text-fg hover:bg-surface-2',
  danger: 'bg-danger text-on-danger hover:brightness-110',
};

// md y lg miden 44 px o mas: es el minimo tactil (WCAG 2.5.8 pide 24; Apple, 44). sm es solo para zonas
// densas del profesor con puntero.
const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-[32px] px-3 text-sm',
  md: 'min-h-[44px] px-4 text-base',
  lg: 'min-h-[52px] px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold cursor-pointer select-none',
        'transition-[filter,background-color,border-color,transform] duration-200 motion-reduce:transition-none',
        'active:scale-[0.98] motion-reduce:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
          <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
});
