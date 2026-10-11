'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Home, Users } from 'lucide-react';
import { LogoutButton } from '@/components/LogoutButton';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { cn } from '@/components/ui/cn';

const NAV = [
  { href: '/teacher/dashboard', label: 'Inicio', icon: Home },
  { href: '/teacher/classrooms', label: 'Mis clases', icon: BookOpen },
  { href: '/teacher/students', label: 'Estudiantes', icon: Users },
] as const;

export interface TeacherShellUser {
  email?: string | null;
  name?: string | null;
}

// Marco de todas las pantallas del profesor: barra lateral en pantallas grandes, barra superior en el movil (antes la
// barra lateral fija de 256 px dejaba sin sitio al contenido en un telefono), enlace para saltar al contenido,
// navegacion con icono Y texto que marca la pagina actual, y selector de tema (claro/oscuro/sistema).
export function TeacherShell({ user, children, pathname: pathnameProp }: { user: TeacherShellUser | null; children: React.ReactNode; pathname?: string }) {
  const fromRouter = usePathname();
  const pathname = pathnameProp ?? fromRouter ?? '';
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const linkClass = (active: boolean) =>
    cn(
      'inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 font-medium transition-colors duration-200 motion-reduce:transition-none',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active ? 'bg-primary/15 text-primary-text' : 'text-fg-muted hover:text-fg hover:bg-surface-2'
    );

  return (
    <div className="theme-scope min-h-dvh md:flex bg-bg text-fg">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-3 focus:text-on-primary"
      >
        Saltar al contenido
      </a>

      {/* Pantallas grandes: barra lateral */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface p-6">
        <div className="flex-1">
          <Link href="/teacher/dashboard" className="mb-8 block rounded text-2xl font-bold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Stud<span className="text-accent-text">.</span>ia
          </Link>
          <nav aria-label="Principal" className="space-y-1.5">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-current={isActive(href) ? 'page' : undefined} className={cn(linkClass(isActive(href)), 'w-full')}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="space-y-3 border-t border-line pt-6">
          <ThemeToggle />
          <p className="break-words text-xs text-fg-muted">{user?.email}</p>
          <p className="text-sm font-medium text-fg">{user?.name}</p>
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Movil: barra superior */}
        <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md md:hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2">
            <Link href="/teacher/dashboard" className="rounded text-xl font-bold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Stud<span className="text-accent-text">.</span>ia
            </Link>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
          <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-2 pb-2">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-current={isActive(href) ? 'page' : undefined} className={cn(linkClass(isActive(href)), 'shrink-0 px-3 text-sm')}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </header>

        <main id="contenido" tabIndex={-1} className="flex-1 overflow-auto p-4 focus:outline-none sm:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
