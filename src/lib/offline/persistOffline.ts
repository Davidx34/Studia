'use client';

import { createClient } from '@/lib/supabase/client';
import { queueOfflineAction } from './queue';

/**
 * Wrapper sobre operaciones de Supabase que:
 * 1. Intenta la operación normalmente.
 * 2. Si está offline, encola la acción en IndexedDB para la UI.
 * 3. El Service Worker se encarga de reintentar el request real cuando vuelva la conexión
 *    (vía BackgroundSyncPlugin).
 *
 * Esto da una doble red de seguridad: el SW reintenta el HTTP, y el queue local
 * permite a la UI mostrar lo que está pendiente.
 */

export async function persistProgressOffline(
  studentId: string,
  moduleId: string,
  data: {
    score: number;
    completion_percentage: number;
    earned_xp: number;
    earned_coins: number;
    time_spent_seconds: number;
  }
): Promise<{ success: boolean; queued: boolean }> {
  const supabase = createClient();

  if (!navigator.onLine) {
    // Encolar antes incluso de intentar
    await queueOfflineAction('lesson_completion', { studentId, moduleId, data });
    return { success: true, queued: true };
  }

  try {
    const { error } = await supabase
      .from('student_progress')
      .update({
        ...data,
        status: 'completed',
        completed_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
      })
      .eq('student_id', studentId)
      .eq('module_id', moduleId);

    if (error) throw error;
    return { success: true, queued: false };
  } catch (error) {
    // Si falla el request (offline mid-call), encolar
    console.warn('[offline] Persist failed, queueing:', error);
    await queueOfflineAction('lesson_completion', { studentId, moduleId, data });
    return { success: true, queued: true };
  }
}

export async function persistXPOffline(
  userId: string,
  newTotalXP: number,
  newLevel: number,
  newCoins: number
): Promise<{ success: boolean; queued: boolean }> {
  const supabase = createClient();

  if (!navigator.onLine) {
    await queueOfflineAction('xp_earned', {
      userId,
      newTotalXP,
      newLevel,
      newCoins,
    });
    return { success: true, queued: true };
  }

  try {
    const { error } = await supabase
      .from('profiles')
      .update({
        total_xp: newTotalXP,
        current_level: newLevel,
        coins: newCoins,
      })
      .eq('id', userId);

    if (error) throw error;
    return { success: true, queued: false };
  } catch (error) {
    console.warn('[offline] XP persist failed, queueing:', error);
    await queueOfflineAction('xp_earned', { userId, newTotalXP, newLevel, newCoins });
    return { success: true, queued: true };
  }
}
