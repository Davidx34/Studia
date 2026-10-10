import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';

interface GameState {
  // Estado del jugador
  hearts: number;
  maxHearts: number;
  coins: number;
  totalXP: number;
  currentLevel: number;
  streakDays: number;
  lastHeartLostAt: string | null;

  // UI state
  isLoaded: boolean;
  showLevelUpModal: boolean;
  pendingXP: number; // XP animándose sumando

  // Acciones
  loadFromProfile: (profile: any) => void;
  recoverHearts: () => Promise<void>;
  setShowLevelUpModal: (show: boolean) => void;
}

// Nivel = floor(sqrt(totalXP / 50))
function calculateLevel(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 50)));
}

function xpForNextLevel(level: number): number {
  return (level + 1) * (level + 1) * 50;
}

// La economia (XP, monedas, corazones, nivel) la ESCRIBE EL SERVIDOR (migraciones 052 y 053): este store solo la
// lee y la muestra. Antes tenia loseHeart, addCoins, spendCoins y addXP, que escribian valores absolutos en
// profiles desde el navegador; ninguna se usaba, y cualquier estudiante podia hacer lo mismo desde la consola.
export const useGameStore = create<GameState>((set, get) => ({
  hearts: 5,
  maxHearts: 5,
  coins: 0,
  totalXP: 0,
  currentLevel: 1,
  streakDays: 0,
  lastHeartLostAt: null,
  isLoaded: false,
  showLevelUpModal: false,
  pendingXP: 0,

  loadFromProfile: (profile) => {
    set({
      hearts: profile.current_hearts ?? 5,
      maxHearts: profile.max_hearts ?? 5,
      coins: profile.coins ?? 0,
      totalXP: profile.total_xp ?? 0,
      currentLevel: profile.current_level ?? 1,
      streakDays: profile.streak_days ?? 0,
      lastHeartLostAt: profile.last_heart_lost_at,
      isLoaded: true,
    });
  },

  recoverHearts: async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase.rpc('recover_hearts', {
      p_user_id: user.id,
    });

    if (data !== null) {
      set({ hearts: data as number });
    }
  },

  setShowLevelUpModal: (show) => set({ showLevelUpModal: show }),
}));

export { calculateLevel, xpForNextLevel };
