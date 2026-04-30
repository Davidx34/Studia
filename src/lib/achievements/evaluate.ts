import { createClient } from '@/lib/supabase/client';

/**
 * Llama a la función `evaluate_achievements` en la DB.
 * Otorga automáticamente todos los logros que el usuario haya desbloqueado
 * desde la última evaluación, y suma sus rewards al perfil.
 *
 * Como el `useNotificationBridge` escucha INSERTs en `user_achievements` vía Realtime,
 * los modales aparecen automáticamente sin código adicional.
 *
 * Llamar después de:
 * - Completar una lección
 * - Cambiar el streak diario
 * - Cualquier acción que pueda desbloquear logros
 */
export async function evaluateAchievements(): Promise<{
  newAchievements: Array<{ achievement_id: string; name: string; rarity: string }>;
  error: Error | null;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { newAchievements: [], error: new Error('No authenticated user') };
  }

  const { data, error } = await supabase.rpc('evaluate_achievements', {
    p_user_id: user.id,
  });

  if (error) {
    console.error('[achievements] evaluation failed:', error);
    return { newAchievements: [], error };
  }

  return { newAchievements: data || [], error: null };
}
