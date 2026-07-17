'use client';

import { useEffect, useRef } from 'react';
import { TonitoCharacter } from './TonitoCharacter';
import { useTonitoStore } from '@/stores/useTonitoStore';

export function TonitoWidget() {
  const { mood, animation, message, skinGradient, toggleChat, isChatOpen, setInactive } =
    useTonitoStore();
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inactivity tracking — Toñito se duerme tras 2 minutos
  useEffect(() => {
    const resetTimer = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      if (mood === 'sleeping') setInactive(false);
      inactivityTimer.current = setTimeout(() => setInactive(true), 2 * 60 * 1000);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer));
    resetTimer();

    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [mood, setInactive]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {/* Speech bubble */}
      {message && !isChatOpen && (
        <div className="pointer-events-auto bg-white/95 backdrop-blur-xl rounded-2xl px-4 py-3 shadow-2xl max-w-xs border-2 border-violet-200 animate-bubble-in">
          <p className="text-sm font-semibold text-slate-800 leading-snug">{message}</p>
          <div className="absolute -bottom-2 right-8 w-4 h-4 bg-white/95 rotate-45 border-r-2 border-b-2 border-violet-200" />
        </div>
      )}

      {/* Toñito clickable */}
      <button
        onClick={toggleChat}
        className="pointer-events-auto group relative hover:scale-110 active:scale-95 transition-transform"
        aria-label="Hablar con Toñito"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-violet-400 to-cyan-400 rounded-full blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />
        <div className="relative bg-white/20 backdrop-blur-xl rounded-full p-2 shadow-2xl border border-white/30">
          <TonitoCharacter mood={mood} animation={animation} gradient={skinGradient} size={72} />
        </div>
      </button>

      <style jsx>{`
        @keyframes bubble-in {
          0% {
            opacity: 0;
            transform: translateY(8px) scale(0.9);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .animate-bubble-in {
          animation: bubble-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
