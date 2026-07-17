'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { LogoutButton } from '@/components/LogoutButton';
import { TonitoChatWidget } from '@/components/tonito/TonitoChatWidget';
import { AchievementUnlockModal } from '@/components/notifications/AchievementUnlockModal';
import { LevelUpModal } from '@/components/notifications/LevelUpModal';
import { ToastContainer } from '@/components/notifications/ToastContainer';
import { useNotificationBridge } from '@/hooks/useNotificationBridge';
import { evaluateAchievements } from '@/lib/achievements/evaluate';
import { SoundToggle } from '@/components/SoundToggle';

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

      // Actualizar racha diaria y evaluar logros (first_login, streak_days, etc.)
      // en background, sin bloquear el render.
      supabase.rpc('check_and_update_streak', { p_user_id: authUser.id }).then(() => {
        evaluateAchievements();
      });
    };

    checkAuth();
  }, [router, supabase]);

  if (loading) {
    return <div className="text-white text-center p-8">Cargando...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-red-500">
      <header className="bg-black bg-opacity-30 backdrop-blur-md border-b border-white border-opacity-10 p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-white">📚 Stud.ia</h1>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/dashboard" className="text-white hover:text-gray-200 transition">
              🏠 Inicio
            </Link>
            <Link href="/achievements" className="text-white hover:text-gray-200 transition">
              ✨ Logros
            </Link>
            <div className="flex items-center gap-3 border-l border-white border-opacity-20 pl-6 ml-6">
              <SoundToggle />
              <div>
                <p className="text-sm text-gray-200">{user?.email}</p>
                <p className="text-white font-medium">{user?.full_name || user?.username}</p>
              </div>
              <LogoutButton />
            </div>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-8">
        {children}
      </main>
      <TonitoChatWidget />
      <ToastContainer />
      <AchievementUnlockModal />
      <LevelUpModal />
    </div>
  );
}
