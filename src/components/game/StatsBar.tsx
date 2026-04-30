'use client';

import { useGameStore, xpForNextLevel } from '@/stores/useGameStore';
import { Coins, Flame, Zap } from 'lucide-react';

export function StatsBar() {
  const { coins, totalXP, currentLevel, streakDays, pendingXP } =
    useGameStore();

  const nextLevelXP = xpForNextLevel(currentLevel);
  const currentLevelXP = xpForNextLevel(currentLevel - 1);
  const progressInLevel = ((totalXP - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100;

  return (
    <div className="sticky top-0 z-40 backdrop-blur-2xl bg-white/10 border-b border-white/20">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        {/* Logo + level */}
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Stud<span className="text-yellow-300">.</span>ia
          </h1>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-violet-500/30 rounded-full border border-violet-400/40">
            <span className="text-xs font-semibold text-white">Nivel {currentLevel}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 sm:gap-5">
          {/* Streak */}
          <div className="flex items-center gap-1.5">
            <Flame className="w-5 h-5 text-orange-400 animate-flicker" />
            <span className="font-bold text-white text-sm">{streakDays}</span>
          </div>

          {/* XP with progress bar */}
          <div className="hidden md:flex flex-col gap-1 min-w-[140px]">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-purple-300" />
                <span className="font-semibold text-white">{totalXP} XP</span>
                {pendingXP > 0 && (
                  <span className="text-yellow-300 font-bold animate-float-up">+{pendingXP}</span>
                )}
              </div>
              <span className="text-white/50">{nextLevelXP}</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-400 to-cyan-400 transition-all duration-700 ease-out"
                style={{ width: `${Math.min(100, progressInLevel)}%` }}
              />
            </div>
          </div>

          {/* Coins */}
          <div className="flex items-center gap-1.5">
            <Coins className="w-5 h-5 text-yellow-300" />
            <span className="font-bold text-white text-sm">{coins}</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes flicker {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.15); filter: brightness(1.3); }
        }
        .animate-flicker { animation: flicker 0.8s ease-in-out infinite; }
        @keyframes float-up {
          0% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-20px); }
        }
        .animate-float-up { animation: float-up 2s ease-out forwards; }
      `}</style>
    </div>
  );
}
