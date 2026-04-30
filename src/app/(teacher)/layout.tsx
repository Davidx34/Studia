'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { LayoutDashboard, Users, BookOpen, LogOut, GraduationCap } from 'lucide-react';

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [profile, setProfile] = useState<{ full_name: string; username: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('full_name, username, role')
        .eq('id', user.id)
        .single();

      if (!mounted) return;
      if (data?.role !== 'teacher' && data?.role !== 'admin') {
        router.push('/dashboard');
        return;
      }
      setProfile({ full_name: data.full_name || '', username: data.username });
    })();
    return () => {
      mounted = false;
    };
  }, [supabase, router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const navItems = [
    { href: '/teacher/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/teacher/classrooms', label: 'Mis clases', icon: GraduationCap },
    { href: '/teacher/students', label: 'Estudiantes', icon: Users },
    { href: '/teacher/content', label: 'Contenido', icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Sidebar (desktop) + top bar (mobile) */}
      <aside className="fixed top-0 left-0 h-full w-64 bg-slate-900 border-r border-slate-800 hidden md:flex flex-col z-30">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Stud<span className="text-violet-400">.</span>ia
          </h1>
          <div className="text-xs text-slate-500 mt-0.5 font-medium uppercase tracking-wider">
            Panel docente
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-white border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {profile && (
          <div className="p-3 border-t border-slate-800">
            <div className="flex items-center gap-3 px-3 py-2 mb-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center font-bold text-white text-sm">
                {profile.full_name.charAt(0) || profile.username.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white truncate">
                  {profile.full_name}
                </div>
                <div className="text-xs text-slate-500 truncate">@{profile.username}</div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              Cerrar sesión
            </button>
          </div>
        )}
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">
          Stud<span className="text-violet-400">.</span>ia
        </h1>
        <nav className="flex gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`p-2 rounded-lg ${
                  isActive ? 'bg-violet-500/15 text-violet-300' : 'text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="md:ml-64 p-6 md:p-8 max-w-6xl">{children}</main>
    </div>
  );
}
