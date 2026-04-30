'use client';

import { useEffect, useMemo } from 'react';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { TonitoCharacter } from '@/components/tonito/TonitoCharacter';

export function LevelUpModal() {
  const fromLevel = useNotificationStore((s) => s.levelUpFromLevel);
  const toLevel = useNotificationStore((s) => s.levelUpToLevel);
  const dismissLevelUp = useNotificationStore((s) => s.dismissLevelUp);
  const skinGradient = useTonitoStore((s) => s.skinGradient);

  // Auto-dismiss tras 6 segundos
  useEffect(() => {
    if (toLevel === null) return;
    const timer = setTimeout(dismissLevelUp, 6500);
    return () => clearTimeout(timer);
  }, [toLevel, dismissLevelUp]);

  // Generar rayos de luz radiales
  const lightRays = useMemo(
    () =>
      Array.from({ length: 12 }).map((_, i) => ({
        rotation: i * 30,
        delay: i * 0.04,
      })),
    []
  );

  // Estrellas explotando
  const stars = useMemo(
    () =>
      Array.from({ length: 24 }).map((_, i) => ({
        id: i,
        angle: (i / 24) * 360,
        distance: 150 + Math.random() * 200,
        delay: 0.3 + Math.random() * 0.4,
        size: 8 + Math.random() * 16,
      })),
    []
  );

  if (toLevel === null || fromLevel === null) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-hidden animate-overlay-in"
      onClick={dismissLevelUp}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/85 backdrop-blur-xl" />

      {/* Light rays */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative w-px h-px">
          {lightRays.map((ray, i) => (
            <div
              key={i}
              className="absolute top-1/2 left-1/2 origin-left animate-ray"
              style={{
                width: '120vw',
                height: '60px',
                transform: `translate(-50%, -50%) rotate(${ray.rotation}deg)`,
                background: 'linear-gradient(90deg, transparent 0%, rgba(253,224,71,0.6) 30%, rgba(251,146,60,0.4) 60%, transparent 100%)',
                animationDelay: `${ray.delay}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Exploding stars */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        {stars.map((star) => {
          const radians = (star.angle * Math.PI) / 180;
          const tx = Math.cos(radians) * star.distance;
          const ty = Math.sin(radians) * star.distance;
          return (
            <div
              key={star.id}
              className="absolute animate-star-burst"
              style={
                {
                  width: `${star.size}px`,
                  height: `${star.size}px`,
                  '--tx': `${tx}px`,
                  '--ty': `${ty}px`,
                  animationDelay: `${star.delay}s`,
                } as React.CSSProperties
              }
            >
              <div className="w-full h-full bg-yellow-300 rounded-full" style={{ boxShadow: '0 0 20px #fde047, 0 0 40px #fbbf24' }} />
            </div>
          );
        })}
      </div>

      {/* Center content */}
      <div
        className="relative flex flex-col items-center text-center px-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Level number animation */}
        <div className="mb-6 animate-level-pop">
          <div className="text-xs font-bold text-yellow-300 uppercase tracking-[0.3em] mb-1">
            ¡Subiste de nivel!
          </div>
          <div className="flex items-center gap-4">
            <div className="text-6xl font-bold text-white/40 line-through">{fromLevel}</div>
            <div className="text-yellow-300 text-3xl animate-arrow">→</div>
            <div
              className="text-8xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 via-yellow-300 to-orange-500 animate-number-glow"
              style={{ filter: 'drop-shadow(0 0 30px rgba(253,224,71,0.8))' }}
            >
              {toLevel}
            </div>
          </div>
        </div>

        {/* Toñito Super Saiyan */}
        <div className="mb-6 animate-tonito-rise">
          <TonitoCharacter
            mood="celebrating"
            animation="supersaiyan"
            gradient={skinGradient}
            size={180}
          />
        </div>

        {/* Banner message */}
        <div className="backdrop-blur-2xl bg-white/15 border-2 border-yellow-300/50 rounded-3xl px-8 py-4 mb-4 shadow-2xl animate-message-in"
          style={{ boxShadow: '0 0 60px rgba(253,224,71,0.4)' }}
        >
          <p className="text-xl font-bold text-white">¡Eres una leyenda! 🏆</p>
          <p className="text-sm text-white/80 mt-1">Toñito está orgulloso de ti</p>
        </div>

        {/* Continue button */}
        <button
          onClick={dismissLevelUp}
          className="px-8 py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-white font-bold rounded-2xl shadow-2xl hover:scale-105 active:scale-95 transition-all animate-button-in"
          style={{ boxShadow: '0 10px 40px rgba(251,146,60,0.5)' }}
        >
          ¡Seguir conquistando! ✨
        </button>
      </div>

      <style jsx>{`
        @keyframes overlay-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes ray {
          0% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--rotation, 0deg)) scaleX(0); }
          50% { opacity: 1; }
          100% { opacity: 0.4; transform: translate(-50%, -50%) rotate(var(--rotation, 0deg)) scaleX(1); }
        }
        @keyframes star-burst {
          0% { opacity: 0; transform: translate(0, 0) scale(0); }
          30% { opacity: 1; transform: translate(calc(var(--tx) * 0.4), calc(var(--ty) * 0.4)) scale(1.3); }
          100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.4); }
        }
        @keyframes level-pop {
          0% { opacity: 0; transform: scale(0.3) translateY(-40px); }
          50% { transform: scale(1.15) translateY(0); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes number-glow {
          0%, 100% { filter: drop-shadow(0 0 20px rgba(253,224,71,0.8)); }
          50% { filter: drop-shadow(0 0 40px rgba(253,224,71,1)); }
        }
        @keyframes arrow {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(6px); }
        }
        @keyframes tonito-rise {
          0% { opacity: 0; transform: translateY(60px) scale(0.5); }
          60% { transform: translateY(-10px) scale(1.1); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes message-in {
          0% { opacity: 0; transform: translateY(20px) scale(0.9); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes button-in {
          0% { opacity: 0; transform: translateY(15px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-overlay-in { animation: overlay-in 0.3s ease-out; }
        .animate-ray { animation: ray 1s ease-out forwards; }
        .animate-star-burst { animation: star-burst 1.8s ease-out forwards; }
        .animate-level-pop { animation: level-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both; }
        .animate-number-glow { animation: number-glow 2s ease-in-out infinite; }
        .animate-arrow { animation: arrow 1s ease-in-out infinite; }
        .animate-tonito-rise { animation: tonito-rise 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s both; }
        .animate-message-in { animation: message-in 0.5s ease-out 1s both; }
        .animate-button-in { animation: button-in 0.5s ease-out 1.4s both; }
      `}</style>
    </div>
  );
}
