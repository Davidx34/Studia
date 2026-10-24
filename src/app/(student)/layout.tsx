'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { StudentShell } from '@/components/student/StudentShell';
import { TonitoChatWidget } from '@/components/tonito/TonitoChatWidget';
import { AchievementUnlockModal } from '@/components/notifications/AchievementUnlockModal';
import { ToastContainer } from '@/components/notifications/ToastContainer';
import { useNotificationBridge } from '@/hooks/useNotificationBridge';
import { evaluateAchievements } from '@/lib/achievements/evaluate';

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  useNotificationBridge();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push('/login');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (profile?.role !== 'student') {
        router.push('/dashboard');
        return;
      }

      setUser(profile);
      setLoading(false);

      // La racha ya NO se actualiza al abrir pantallas: la actualiza la base cuando el estudiante ESTUDIA (responde una
      // pregunta o repasa una flashcard; migracion 071). Aqui solo se evaluan logros (first_login, etc.) en background,
      // sin bloquear el render.
      void evaluateAchievements();
    };

    checkAuth();
  }, [router, supabase]);

  if (loading) {
    return <div className="text-white text-center p-8">Cargando...</div>;
  }

  return (
    <StudentShell user={{ email: user?.email, name: user?.full_name || user?.username }}>
      {children}
      <TonitoChatWidget />
      <ToastContainer />
      <AchievementUnlockModal />
    </StudentShell>
  );
}
