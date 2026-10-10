'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Map as MapIcon, Trophy } from 'lucide-react';
import { LogoutButton } from '@/components/LogoutButton';
import { SoundToggle } from '@/components/SoundToggle';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { cn } from '@/components/ui/cn';
import { isThemedStudentRoute } from '@/lib/design/themedRoutes';

const NAV = [
  { href: '/dashboard', label: 'Inicio', icon: Home },
  { href: '/map', label: 'Mapa', icon: MapIcon },
  { href: '/achievements', label: 'Logros', icon: Trophy },
] as const;

export interface ShellUser {
  email?: string | null;
  name?: string | null;
}

// Marco de todas las pantallas del estudiante: cabecera, navegacion (arriba en pantallas grandes, abajo en el
// movil, con icono Y texto) y selector de tema. El tema claro solo se activa en las rutas ya migradas
// (themedRoutes.ts); en las demas el marco se ve oscuro, como siempre.
export function StudentShell({ user, children, pathname: pathnameProp }: { user: ShellUser | null; children: React.ReactNode; pathname?: string }) {
  const fromRouter = usePathname();
  const pathname = pathnameProp ?? fromRouter ?? '';
  const themed = isThemedStudentRoute(pathname);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div
      className={cn(
        'min-h-dvh relative isolate',
        themed ? 'theme-scope' : 'bg-slate-950 bg-gradient-to-br from-violet-900 via-fuchsia-900/60 to-slate-950'
      )}
    >
      {!themed && (
        <div className="absolute inset-0 -z-10 opacity-40" aria-hidden="true">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-fuchsia-500 rounded-full mix-blend-screen filter blur-[120px]" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-400 rounded-full mix-blend-screen filter blur-[120px]" />
        </div>
      )}

      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-3 focus:text-on-primary"
      >
        Saltar al contenido
      </a>

      <header className={cn('sticky top-0 z-40 backdrop-blur-md border-b', themed ? 'bg-surface/85 border-line' : 'bg-black/30 border-white/10')}>
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className={cn('text-2xl font-bold tracking-tight rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', themed ? 'text-fg' : 'text-white')}>
            Stud<span className={themed ? 'text-accent-text' : 'text-amber-300'}>.</span>ia
          </Link>

          <nav aria-label="Principal" className="hidden md:flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 font-medium transition-colors duration-200 motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive(href) ? 'bg-primary/15 text-primary-text' : themed ? 'text-fg-muted hover:text-fg hover:bg-surface-2' : 'text-white/80 hover:text-white hover:bg-white/10'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {themed && <ThemeToggle className="hidden sm:inline-flex" />}
            <SoundToggle />
            <div className="hidden lg:block text-right leading-tight">
              <p className={cn('text-sm', themed ? 'text-fg-muted' : 'text-white/50')}>{user?.email}</p>
              <p className={cn('font-medium', themed ? 'text-fg' : 'text-white')}>{user?.name}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main id="contenido" tabIndex={-1} className="max-w-7xl mx-auto px-4 py-6 sm:p-8 pb-28 md:pb-8 focus:outline-none">
        {children}
      </main>

      {/* Navegacion inferior en movil: maximo 5 destinos, con icono y texto. */}
      <nav
        aria-label="Principal"
        className={cn(
          'md:hidden fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-md pb-[env(safe-area-inset-bottom)]',
          themed ? 'bg-surface/95 border-line' : 'bg-black/60 border-white/10'
        )}
      >
        <ul className="mx-auto grid max-w-md grid-cols-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-medium',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  isActive(href) ? (themed ? 'text-primary-text' : 'text-white') : themed ? 'text-fg-muted' : 'text-white/60'
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
