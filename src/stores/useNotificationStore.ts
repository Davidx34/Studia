import { create } from 'zustand';

export type ToastVariant = 'xp' | 'coins' | 'streak' | 'mission' | 'heart' | 'info' | 'error';

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  subtitle?: string;
  amount?: number;
  durationMs?: number;
}

export interface AchievementUnlock {
  id: string;
  name: string;
  description: string;
  icon: string; // emoji
  color: string; // hex
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  rewardCoins: number;
  rewardXP: number;
}

interface NotificationState {
  toasts: Toast[];
  achievementQueue: AchievementUnlock[];
  currentAchievement: AchievementUnlock | null;
  levelUpFromLevel: number | null;
  levelUpToLevel: number | null;

  // Toast actions
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;

  // Achievement actions
  queueAchievement: (achievement: AchievementUnlock) => void;
  showNextAchievement: () => void;
  dismissAchievement: () => void;

  // Level up
  triggerLevelUp: (from: number, to: number) => void;
  dismissLevelUp: () => void;
}

let toastIdCounter = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toasts: [],
  achievementQueue: [],
  currentAchievement: null,
  levelUpFromLevel: null,
  levelUpToLevel: null,

  pushToast: (toast) => {
    const id = `toast-${++toastIdCounter}-${Date.now()}`;
    const newToast: Toast = { id, durationMs: 3500, ...toast };

    set((state) => ({ toasts: [...state.toasts, newToast] }));

    // Auto-dismiss
    setTimeout(() => {
      get().dismissToast(id);
    }, newToast.durationMs);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  queueAchievement: (achievement) => {
    set((state) => {
      // Si no hay nada mostrándose, mostrar de inmediato
      if (!state.currentAchievement) {
        return { currentAchievement: achievement };
      }
      // Si ya hay uno, encolar
      return { achievementQueue: [...state.achievementQueue, achievement] };
    });
  },

  showNextAchievement: () => {
    set((state) => {
      const [next, ...rest] = state.achievementQueue;
      return {
        currentAchievement: next || null,
        achievementQueue: rest,
      };
    });
  },

  dismissAchievement: () => {
    set({ currentAchievement: null });
    // Mostrar el siguiente tras una pausa
    setTimeout(() => {
      get().showNextAchievement();
    }, 400);
  },

  triggerLevelUp: (from, to) => {
    set({ levelUpFromLevel: from, levelUpToLevel: to });
  },

  dismissLevelUp: () => {
    set({ levelUpFromLevel: null, levelUpToLevel: null });
  },
}));
