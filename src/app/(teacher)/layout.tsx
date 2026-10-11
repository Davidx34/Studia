'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TeacherShell } from '@/components/teacher/TeacherShell';

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

  if (loading) return <div role="status" className="theme-scope min-h-dvh bg-bg p-8 text-center text-fg-muted">Cargando…</div>;

  return <TeacherShell user={{ email: user?.email, name: user?.full_name || user?.username }}>{children}</TeacherShell>;
}
