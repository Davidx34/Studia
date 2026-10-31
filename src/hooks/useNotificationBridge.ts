'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { toAchievement } from '@/lib/achievements/normalize';

/**
 * Hook que conecta el game state con el sistema de notificaciones.
 * - Detecta achievements nuevos vía Realtime → queueAchievement
 *
 * Llamarlo UNA SOLA VEZ desde el (student)/layout.tsx
 */
export function useNotificationBridge() {
  const supabase = createClient();
  const queueAchievement = useNotificationStore((s) => s.queueAchievement);
  // Realtime: escuchar nuevos achievements
  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !mounted) return;

      const channel = supabase
        .channel(`achievements-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'user_achievements',
            filter: `user_id=eq.${user.id}`,
          },
          async (payload) => {
            // Cargar los detalles del achievement
            const { data: achievement } = await supabase
              .from('achievements')
              .select('*')
              .eq('id', payload.new.achievement_id)
              .single();

            if (achievement && mounted) {
              // Mapear icono según nombre del achievement
              const iconMap: Record<string, string> = {
                'Primer Login': '🎉',
                'Primeros Pasos': '👣',
                'Racha de 3': '🔥',
                'Racha de 7': '⚡',
                'Racha de 30': '👑',
                'Maestro de Matemáticas': '🔢',
                'Científico Natural': '🔬',
                'Historiador': '📜',
                'Lingüista': '📖',
                'Mente Lógica': '🧩',
                'Perfeccionista': '⭐',
                'Imparable': '🚀',
                'Leyenda': '🏆',
              };

              const normalized = toAchievement(achievement);
              queueAchievement({
                id: achievement.id,
                name: achievement.name,
                description: achievement.description || '',
                icon: iconMap[achievement.name] || '🏆',
                color: achievement.color || '#FFD700',
                rarity: normalized.rarity,
                rewardCoins: normalized.reward_coins,
              });
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    const cleanup = setup();
    return () => {
      mounted = false;
      cleanup.then((fn) => fn?.());
    };
  }, [supabase, queueAchievement]);
}
