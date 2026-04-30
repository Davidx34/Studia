import { create } from 'zustand';

export type TonitoMood =
  | 'happy'
  | 'excited'
  | 'thinking'
  | 'sad'
  | 'surprised'
  | 'sleeping'
  | 'celebrating'
  | 'encouraging';

export type TonitoAnimation =
  | 'idle'
  | 'bounce'
  | 'shake'
  | 'spin'
  | 'pulse'
  | 'sleep'
  | 'jump'
  | 'supersaiyan';

interface TonitoState {
  mood: TonitoMood;
  animation: TonitoAnimation;
  message: string | null;
  isChatOpen: boolean;
  skinGradient: [string, string];
  isInactive: boolean;

  // Acciones
  setMood: (mood: TonitoMood) => void;
  triggerAnimation: (anim: TonitoAnimation, durationMs?: number) => void;
  showMessage: (msg: string, durationMs?: number) => void;
  hideMessage: () => void;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  setSkin: (colors: [string, string]) => void;
  setInactive: (inactive: boolean) => void;

  // Reacciones de gameplay
  onCorrectAnswer: () => void;
  onWrongAnswer: () => void;
  onStreak: (days: number) => void;
  onLevelUp: () => void;
}

export const useTonitoStore = create<TonitoState>((set, get) => ({
  mood: 'happy',
  animation: 'idle',
  message: null,
  isChatOpen: false,
  skinGradient: ['#6C5CE7', '#00D2D3'],
  isInactive: false,

  setMood: (mood) => set({ mood }),

  triggerAnimation: (anim, durationMs = 1000) => {
    set({ animation: anim });
    setTimeout(() => set({ animation: 'idle' }), durationMs);
  },

  showMessage: (msg, durationMs = 4000) => {
    set({ message: msg });
    if (durationMs > 0) {
      setTimeout(() => set({ message: null }), durationMs);
    }
  },

  hideMessage: () => set({ message: null }),
  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  setChatOpen: (open) => set({ isChatOpen: open }),
  setSkin: (colors) => set({ skinGradient: colors }),
  setInactive: (inactive) => {
    set({ isInactive: inactive });
    if (inactive) {
      set({ mood: 'sleeping', animation: 'sleep' });
    } else {
      set({ mood: 'surprised', animation: 'bounce' });
      setTimeout(() => set({ mood: 'happy', animation: 'idle' }), 1500);
    }
  },

  // Gameplay reactions
  onCorrectAnswer: () => {
    const messages = [
      '¡Excelente! 🎯',
      '¡Qué crack! 💪',
      '¡Eso estuvo épico! 🌟',
      '¡Así se hace! 🔥',
      '¡Genial! Sigues imparable 🚀',
    ];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    set({ mood: 'excited', animation: 'jump', message: msg });
    setTimeout(
      () => set({ mood: 'happy', animation: 'idle', message: null }),
      2500
    );
  },

  onWrongAnswer: () => {
    const messages = [
      '¡Casi! Intentemos de nuevo 💪',
      'No te preocupes, ¡tú puedes! 🤗',
      'Error es aprender. ¡Vamos otra vez! 📚',
      '¡Ánimo! La próxima seguro 🌈',
    ];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    set({ mood: 'encouraging', animation: 'shake', message: msg });
    setTimeout(
      () => set({ mood: 'happy', animation: 'idle', message: null }),
      3000
    );
  },

  onStreak: (days) => {
    set({
      mood: 'celebrating',
      animation: 'spin',
      message: `¡Racha de ${days} días! 🔥🔥🔥`,
    });
    setTimeout(
      () => set({ mood: 'happy', animation: 'idle', message: null }),
      3000
    );
  },

  onLevelUp: () => {
    set({
      mood: 'celebrating',
      animation: 'supersaiyan',
      message: '¡SUBISTE DE NIVEL! 🎉✨🏆',
    });
    setTimeout(
      () => set({ mood: 'happy', animation: 'idle', message: null }),
      5000
    );
  },
}));
