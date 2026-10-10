'use client';

import { useEffect, useState } from 'react';
import { cn } from './cn';
import { DEFAULT_THEME_PREFERENCE, THEME_STORAGE_KEY, parseThemePreference, resolveTheme, type ThemePreference } from '@/lib/design/theme';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' },
];

function apply(preference: ThemePreference) {
  const light = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.setAttribute('data-theme', resolveTheme(preference, light));
}

// Selector de tema. Es una OPCION: por defecto la app se ve oscura como siempre.
export function ThemeToggle({ className }: { className?: string }) {
  const [preference, setPreference] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);

  useEffect(() => {
    try {
      setPreference(parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)));
    } catch {
      // sin almacenamiento (ventana privada): se queda el valor por defecto
    }
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  function choose(next: ThemePreference) {
    setPreference(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // no se pudo guardar: igual se aplica en esta sesion
    }
    apply(next);
  }

  return (
    <div role="group" aria-label="Tema de color" className={cn('inline-flex rounded-xl border border-line bg-surface-2 p-0.5', className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={preference === o.value}
          onClick={() => choose(o.value)}
          className={cn(
            'min-h-[36px] px-3 rounded-[10px] text-sm font-medium cursor-pointer transition-colors duration-200 motion-reduce:transition-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            preference === o.value ? 'bg-primary text-on-primary' : 'text-fg-muted hover:text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
