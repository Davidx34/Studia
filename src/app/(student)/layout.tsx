'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useGameStore } from '@/stores/useGameStore';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { useNotificationBridge } from '@/hooks/useNotificationBridge';
import { StatsBar } from '@/components/game/StatsBar';
import { TonitoChatWidget } from '@/components/tonito/TonitoChatWidget';
import { ToastContainer } from '@/components/notifications/ToastContainer';
import { AchievementUnlockModal } from '@/components/notifications/AchievementUnlockModal';
import { LevelUpModal } from '@/components/notifications/LevelUpModal';

const SKINS: Record<string, [string, string]> = {
  default: ['#6C5CE7', '#00D2D3'],
  ocean: ['#0652DD', '#1B9CFC'],
  lava: ['#EA2027', '#F79F1F'],
  forest: ['#009432', '#A3CB38'],
  galaxy: ['#6C5CE7', '#FD79A8'],
  rainbow: ['#FF6B6B', '#4ECDC4'],
};

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = createClient();
  const loadFromProfile = useGameStore((s) => s.loadFromProfile);
  const isLoaded = useGameStore((s) => s.isLoaded);
  const setSkin = useTonitoStore((s) => s.setSkin);

  useNotificationBridge();

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (!mounted || !profile) return;

      loadFromProfile(profile);
      const skinName = profile.tonito_state?.skin || 'default';
      setSkin(SKINS[skinName] || SKINS.default);
    };

    loadProfile();

    const channel = supabase
      .channel('profile-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          if (mounted) loadFromProfile(payload.new);
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, router, loadFromProfile, setSkin]);

  const hour = new Date().getHours();
  const bgGradient =
    hour >= 6 && hour < 12
      ? 'from-amber-300 via-orange-400 to-pink-500'
      : hour >= 12 && hour < 18
      ? 'from-sky-400 via-blue-500 to-violet-600'
      : hour >= 18 && hour < 21
      ? 'from-purple-600 via-pink-600 to-orange-500'
      : 'from-slate-900 via-purple-900 to-slate-900';

  if (!isLoaded) {
    return (
      <div className={`min-h-screen bg-gradient-to-br ${bgGradient} flex items-center justify-center`}>
        <div className="text-white text-lg font-medium animate-pulse">Cargando tu mundo...</div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gradient-to-br ${bgGradient} text-white`}>
      <StatsBar />
      <main className="max-w-6xl mx-auto px-4 py-6 pb-32">{children}</main>

      {/* Toñito conversacional + sistema de notificaciones */}
      <TonitoChatWidget />
      <ToastContainer />
      <AchievementUnlockModal />
      <LevelUpModal />
    </div>
  );
}
