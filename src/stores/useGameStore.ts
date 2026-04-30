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
  loseHeart: () => Promise<void>;
  addCoins: (amount: number) => void;
  spendCoins: (amount: number) => boolean;
  addXP: (amount: number) => Promise<void>;
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

  loseHeart: async () => {
    const { hearts } = get();
    if (hearts <= 0) return;

    const newHearts = hearts - 1;
    const now = new Date().toISOString();

    set({ hearts: newHearts, lastHeartLostAt: now });

    // Sync con DB
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('profiles')
        .update({ current_hearts: newHearts, last_heart_lost_at: now })
        .eq('id', user.id);
    }
  },

  addCoins: (amount) => {
    const newCoins = get().coins + amount;
    set({ coins: newCoins });

    // Async sync (fire & forget)
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase
          .from('profiles')
          .update({ coins: newCoins })
          .eq('id', user.id);
      }
    });
  },

  spendCoins: (amount) => {
    const { coins } = get();
    if (coins < amount) return false;

    const newCoins = coins - amount;
    set({ coins: newCoins });

    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase
          .from('profiles')
          .update({ coins: newCoins })
          .eq('id', user.id);
      }
    });

    return true;
  },

  addXP: async (amount) => {
    const { totalXP, currentLevel } = get();
    const newXP = totalXP + amount;
    const newLevel = calculateLevel(newXP);
    const didLevelUp = newLevel > currentLevel;

    set({
      totalXP: newXP,
      currentLevel: newLevel,
      pendingXP: amount,
      showLevelUpModal: didLevelUp,
    });

    // Limpiar pendingXP después de la animación
    setTimeout(() => set({ pendingXP: 0 }), 2000);

    // Sync con DB
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('profiles')
        .update({
          total_xp: newXP,
          current_level: newLevel,
        })
        .eq('id', user.id);
    }
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
