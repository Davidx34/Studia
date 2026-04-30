'use client';

import { useEffect, useMemo } from 'react';
import { useNotificationStore, type AchievementUnlock } from '@/stores/useNotificationStore';
import { Trophy, Sparkles, Coins, Zap } from 'lucide-react';

const RARITY_CONFIG = {
  common: {
    label: 'Común',
    glowColor: '#94a3b8',
    accentColor: '#cbd5e1',
    particleCount: 12,
    bgGradient: 'from-slate-600 to-slate-800',
  },
  rare: {
    label: 'Raro',
    glowColor: '#3b82f6',
    accentColor: '#60a5fa',
    particleCount: 20,
    bgGradient: 'from-blue-600 to-indigo-800',
  },
  epic: {
    label: 'Épico',
    glowColor: '#a855f7',
    accentColor: '#c084fc',
    particleCount: 30,
    bgGradient: 'from-purple-600 to-fuchsia-800',
  },
  legendary: {
    label: 'Legendario',
    glowColor: '#fbbf24',
    accentColor: '#fde047',
    particleCount: 50,
    bgGradient: 'from-amber-500 to-orange-700',
  },
};

export function AchievementUnlockModal() {
  const currentAchievement = useNotificationStore((s) => s.currentAchievement);
  const dismissAchievement = useNotificationStore((s) => s.dismissAchievement);

  // Auto-dismiss tras 6 segundos
  useEffect(() => {
    if (!currentAchievement) return;
    const timer = setTimeout(dismissAchievement, 6000);
    return () => clearTimeout(timer);
  }, [currentAchievement, dismissAchievement]);

  if (!currentAchievement) return null;

  return <AchievementCard achievement={currentAchievement} onDismiss={dismissAchievement} />;
}

function AchievementCard({
  achievement,
  onDismiss,
}: {
  achievement: AchievementUnlock;
  onDismiss: () => void;
}) {
  const config = RARITY_CONFIG[achievement.rarity];

  // Generar partículas de confeti aleatorias
  const particles = useMemo(
    () =>
      Array.from({ length: config.particleCount }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.8 + Math.random() * 1.4,
        size: 4 + Math.random() * 6,
        rotation: Math.random() * 360,
        color: [config.glowColor, config.accentColor, '#fff', '#fde047'][
          Math.floor(Math.random() * 4)
        ],
      })),
    [config.particleCount, config.glowColor, config.accentColor]
  );

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-overlay-in"
      onClick={onDismiss}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

      {/* Confetti particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute top-1/3 animate-confetti"
            style={{
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              transform: `rotate(${p.rotation}deg)`,
              borderRadius: p.id % 2 === 0 ? '50%' : '2px',
              boxShadow: `0 0 12px ${p.color}`,
            }}
          />
        ))}
      </div>

      {/* Card */}
      <div
        className="relative max-w-sm w-full animate-card-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow halo */}
        <div
          className="absolute inset-0 rounded-3xl blur-2xl opacity-70 animate-pulse-glow"
          style={{ background: `radial-gradient(circle, ${config.glowColor}, transparent 70%)` }}
        />

        {/* Card content */}
        <div className="relative backdrop-blur-2xl bg-white/15 border-2 rounded-3xl overflow-hidden shadow-2xl"
          style={{ borderColor: `${config.glowColor}aa` }}
        >
          {/* Top label */}
          <div
            className={`bg-gradient-to-r ${config.bgGradient} py-3 text-center relative overflow-hidden`}
          >
            <div className="absolute inset-0 animate-shine"
              style={{
                background: `linear-gradient(90deg, transparent, ${config.accentColor}66, transparent)`,
              }}
            />
            <div className="relative flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-white" />
              <span className="text-xs font-bold text-white uppercase tracking-widest">
                ¡Logro desbloqueado!
              </span>
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div
              className="text-[10px] font-bold uppercase tracking-wider mt-0.5"
              style={{ color: config.accentColor }}
            >
              {config.label}
            </div>
          </div>

          {/* Body */}
          <div className="p-6 text-center">
            {/* Trophy icon with rotating ring */}
            <div className="relative w-24 h-24 mx-auto mb-4">
              {/* Rotating outer ring */}
              <div
                className="absolute inset-0 rounded-full animate-spin-slow"
                style={{
                  background: `conic-gradient(from 0deg, transparent, ${config.glowColor}, transparent)`,
                  filter: 'blur(8px)',
                }}
              />
              {/* Inner circle with icon */}
              <div
                className="absolute inset-2 rounded-full flex items-center justify-center text-5xl shadow-2xl"
                style={{
                  background: `linear-gradient(135deg, ${config.glowColor}, ${config.accentColor})`,
                  boxShadow: `0 0 40px ${config.glowColor}`,
                }}
              >
                {achievement.icon || '🏆'}
              </div>
            </div>

            {/* Name */}
            <h3 className="text-2xl font-bold text-white mb-1">{achievement.name}</h3>
            <p className="text-sm text-white/70 mb-5">{achievement.description}</p>

            {/* Rewards */}
            {(achievement.rewardCoins > 0 || achievement.rewardXP > 0) && (
              <div className="flex items-center justify-center gap-3 mb-5">
                {achievement.rewardCoins > 0 && (
                  <div className="flex items-center gap-1.5 bg-white/15 border border-white/25 rounded-full px-3 py-1.5">
                    <Coins className="w-4 h-4 text-yellow-300" />
                    <span className="font-bold text-white text-sm">+{achievement.rewardCoins}</span>
                  </div>
                )}
                {achievement.rewardXP > 0 && (
                  <div className="flex items-center gap-1.5 bg-white/15 border border-white/25 rounded-full px-3 py-1.5">
                    <Zap className="w-4 h-4 text-purple-300" />
                    <span className="font-bold text-white text-sm">+{achievement.rewardXP} XP</span>
                  </div>
                )}
              </div>
            )}

            {/* Dismiss button */}
            <button
              onClick={onDismiss}
              className="w-full py-3 bg-gradient-to-r from-white/20 to-white/10 hover:from-white/30 hover:to-white/20 text-white font-bold rounded-2xl border border-white/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              ¡Genial! ✨
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes overlay-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes card-in {
          0% { opacity: 0; transform: scale(0.7) translateY(20px); }
          60% { transform: scale(1.05) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes confetti {
          0% { transform: translateY(-20vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(120vh) rotate(720deg); opacity: 0; }
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
        }
        @keyframes shine {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes spin-slow {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .animate-overlay-in { animation: overlay-in 0.3s ease-out; }
        .animate-card-in { animation: card-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .animate-confetti { animation: confetti linear forwards; }
        .animate-pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
        .animate-shine { animation: shine 2s linear infinite; }
        .animate-spin-slow { animation: spin-slow 4s linear infinite; }
      `}</style>
    </div>
  );
}
