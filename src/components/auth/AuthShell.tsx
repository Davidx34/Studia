'use client';

import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { cn } from '@/components/ui/cn';

// Marco visual de las paginas de acceso: el mismo fondo y la misma tarjeta para login y recuperacion de
// contraseña, para que se sientan parte del producto.
//
// `themeable`: la pantalla ya usa tokens de color, asi que acepta el tema claro y muestra el selector.
// Las paginas que todavia tienen colores fijos (signup, olvide/restablecer contraseña) NO lo activan y
// siguen oscuras: de lo contrario su texto blanco quedaria ilegible sobre fondo claro.
export function AuthShell({ subtitle, children, themeable = false }: { subtitle?: string; children: React.ReactNode; themeable?: boolean }) {
  return (
    <div
      className={cn(
        'min-h-dvh flex items-center justify-center px-4 py-8 relative overflow-hidden isolate',
        themeable ? 'theme-scope' : 'bg-slate-950'
      )}
    >
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 [html[data-theme=light]_.theme-scope_&]:from-violet-100 [html[data-theme=light]_.theme-scope_&]:via-bg [html[data-theme=light]_.theme-scope_&]:to-violet-50" />
      <div className="dark-only absolute inset-0 -z-10 opacity-25" aria-hidden="true">
        <div className="absolute top-20 left-20 w-72 h-72 bg-fuchsia-500 rounded-full mix-blend-screen filter blur-3xl animate-blob" />
        <div className="absolute top-40 right-20 w-72 h-72 bg-amber-300 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute bottom-20 left-1/2 w-72 h-72 bg-cyan-400 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-4000" />
      </div>

      {themeable && (
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
      )}

      <main className="w-full max-w-md premium-fade-in-up">
        <div className="text-center mb-8">
          <h1 className={cn('text-5xl font-bold tracking-tight', themeable ? 'text-fg' : 'text-white')}>
            Stud<span className={themeable ? 'text-accent-text' : ''} style={themeable ? undefined : { color: 'var(--premium-gold)' }}>.</span>ia
          </h1>
          {subtitle && <p className={cn('mt-2', themeable ? 'text-fg-muted' : 'text-white/60')}>{subtitle}</p>}
        </div>

        <div
          className={cn(
            'rounded-3xl p-8 shadow-2xl',
            themeable ? 'bg-surface/80 border border-line backdrop-blur-xl text-fg' : 'premium-card backdrop-blur-2xl bg-white/[0.04]'
          )}
        >
          {children}
        </div>
      </main>

      <style jsx>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        .animate-blob { animation: blob 7s infinite; }
        .animation-delay-2000 { animation-delay: 2s; }
        .animation-delay-4000 { animation-delay: 4s; }
      `}</style>
    </div>
  );
}
