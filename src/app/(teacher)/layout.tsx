'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { LogoutButton } from '@/components/LogoutButton';

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { router.push('/login'); return; }
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
      if (profile?.role !== 'teacher') { router.push('/dashboard'); return; }
      setUser(profile);
      setLoading(false);
    };
    checkAuth();
  }, [router, supabase]);

  if (loading) return <div className="text-white text-center p-8">Cargando...</div>;

  return (
    <div className="flex min-h-screen bg-slate-900">
      <aside className="w-64 bg-slate-800 border-r border-slate-700 p-6 flex flex-col">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white mb-8">📚 Stud.ia</h1>
          <nav className="space-y-3">
            <Link
              href="/teacher/classrooms"
              className="block px-4 py-2 rounded text-slate-200 hover:bg-slate-700 transition-colors"
            >
              📖 Mis Clases
            </Link>
            <Link
              href="/dashboard"
              className="block px-4 py-2 rounded text-slate-200 hover:bg-slate-700 transition-colors"
            >
              🎯 Dashboard
            </Link>
          </nav>
        </div>
        <div className="border-t border-slate-700 pt-6 space-y-3">
          <p className="text-xs text-slate-400 break-words">{user?.email}</p>
          <p className="text-sm text-slate-300 font-medium">{user?.full_name || user?.username}</p>
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
