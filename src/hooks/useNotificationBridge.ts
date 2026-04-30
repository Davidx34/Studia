'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useGameStore } from '@/stores/useGameStore';
import { useNotificationStore } from '@/stores/useNotificationStore';

/**
 * Hook que conecta el game state con el sistema de notificaciones.
 * - Detecta cambios de level → triggerLevelUp
 * - Detecta XP entrante → toast XP
 * - Detecta achievements nuevos vía Realtime → queueAchievement
 *
 * Llamarlo UNA SOLA VEZ desde el (student)/layout.tsx
 */
export function useNotificationBridge() {
  const supabase = createClient();
  const pushToast = useNotificationStore((s) => s.pushToast);
  const queueAchievement = useNotificationStore((s) => s.queueAchievement);
  const triggerLevelUp = useNotificationStore((s) => s.triggerLevelUp);
  const setShowLevelUpModal = useGameStore((s) => s.setShowLevelUpModal);

  const prevLevel = useRef<number | null>(null);
  const prevXP = useRef<number | null>(null);

  // Watch level + XP changes en el store
  useEffect(() => {
    const unsubscribe = useGameStore.subscribe((state) => {
      // Level up detection — actualizar refs ANTES de llamar setShowLevelUpModal
      // para evitar el ciclo infinito (setShowLevelUpModal dispara la suscripción de nuevo)
      if (prevLevel.current !== null && state.currentLevel > prevLevel.current) {
        const fromLevel = prevLevel.current;
        prevLevel.current = state.currentLevel; // actualizar PRIMERO
        triggerLevelUp(fromLevel, state.currentLevel);
        setShowLevelUpModal(false);
      } else {
        prevLevel.current = state.currentLevel;
      }

      // XP toast (solo cuando aumenta)
      if (
        prevXP.current !== null &&
        state.totalXP > prevXP.current &&
        state.pendingXP > 0
      ) {
        pushToast({
          variant: 'xp',
          title: 'XP ganada',
          amount: state.pendingXP,
          durationMs: 2500,
        });
      }
      prevXP.current = state.totalXP;
    });

    return unsubscribe;
  }, [pushToast, triggerLevelUp, setShowLevelUpModal]);

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

              queueAchievement({
                id: achievement.id,
                name: achievement.name,
                description: achievement.description || '',
                icon: iconMap[achievement.name] || '🏆',
                color: achievement.color || '#FFD700',
                rarity: achievement.rarity,
                rewardCoins: achievement.reward_coins,
                rewardXP: achievement.reward_xp,
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
