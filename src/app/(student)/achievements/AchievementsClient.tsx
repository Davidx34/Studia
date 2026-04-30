'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trophy, Lock, Sparkles, Crown } from 'lucide-react';

interface Achievement {
  id: string;
  name: string;
  description: string | null;
  icon_name: string;
  color: string;
  criteria_type: string;
  criteria_value: number;
  criteria_category: string | null;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  reward_coins: number;
  reward_xp: number;
  sort_order: number;
}

interface UserAchievement {
  achievement_id: string;
  earned_at: string;
  seen_by_user: boolean;
}

interface Props {
  allAchievements: Achievement[];
  userAchievements: UserAchievement[];
  progressContext: {
    totalXP: number;
    streakDays: number;
    modulesCompleted: number;
    perfectScores: number;
    categoryCompleted: Record<string, number>;
  };
}

const RARITY_META: Record<
  string,
  { label: string; color: string; gradient: string; order: number }
> = {
  common: { label: 'Común', color: '#94a3b8', gradient: 'from-slate-500 to-slate-700', order: 0 },
  rare: { label: 'Raro', color: '#3b82f6', gradient: 'from-blue-500 to-indigo-700', order: 1 },
  epic: { label: 'Épico', color: '#a855f7', gradient: 'from-purple-500 to-fuchsia-700', order: 2 },
  legendary: { label: 'Legendario', color: '#fbbf24', gradient: 'from-amber-400 to-orange-600', order: 3 },
};

const ICON_MAP: Record<string, string> = {
  'Primer Login': '🎉',
  'Primeros Pasos': '👣',
  'Racha de 3': '🔥',
  'Racha de 7': '⚡',
  'Racha de 30': '👑',
  'Maestro de Matemáticas': '🔢',
  'Científico Natural': '🔬',
  'Historiador': '📜',
  'Lingüista': '📖',
  'Mente Lógica': '🧩',
  'Perfeccionista': '⭐',
  'Imparable': '🚀',
  'Leyenda': '🏆',
};

export function AchievementsClient({ allAchievements, userAchievements, progressContext }: Props) {
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all');

  const earnedMap = useMemo(
    () => new Map(userAchievements.map((ua) => [ua.achievement_id, ua])),
    [userAchievements]
  );

  // Calcular progreso actual hacia cada achievement bloqueado
  const computeProgress = (a: Achievement): { current: number; target: number; pct: number } => {
    let current = 0;
    const target = a.criteria_value;

    switch (a.criteria_type) {
      case 'modules_completed':
        current = progressContext.modulesCompleted;
        break;
      case 'streak_days':
        current = progressContext.streakDays;
        break;
      case 'xp_total':
        current = progressContext.totalXP;
        break;
      case 'perfect_scores':
        current = progressContext.perfectScores;
        break;
      case 'specific_category':
        current = progressContext.categoryCompleted[a.criteria_category || ''] || 0;
        break;
      case 'first_login':
        current = 1;
        break;
    }

    return {
      current,
      target,
      pct: Math.min(100, Math.round((current / target) * 100)),
    };
  };

  // Agrupar por rareza
  const grouped = useMemo(() => {
    const groups: Record<string, Achievement[]> = { common: [], rare: [], epic: [], legendary: [] };
    for (const a of allAchievements) {
      groups[a.rarity]?.push(a);
    }
    return groups;
  }, [allAchievements]);

  // Filtrar
  const filtered = useMemo(() => {
    const result: Record<string, Achievement[]> = { common: [], rare: [], epic: [], legendary: [] };
    for (const rarity of Object.keys(grouped)) {
      result[rarity] = grouped[rarity].filter((a) => {
        const isEarned = earnedMap.has(a.id);
        if (filter === 'unlocked') return isEarned;
        if (filter === 'locked') return !isEarned;
        return true;
      });
    }
    return result;
  }, [grouped, filter, earnedMap]);

  const totalCount = allAchievements.length;
  const earnedCount = userAchievements.length;
  const completionPct = totalCount > 0 ? Math.round((earnedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al inicio
      </Link>

      {/* Hero header con progreso global */}
      <div className="relative backdrop-blur-2xl bg-white/15 border border-white/25 rounded-3xl p-6 sm:p-8 overflow-hidden shadow-2xl">
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-yellow-300/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-violet-400/15 rounded-full blur-3xl" />

        <div className="relative">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-xl">
                <Trophy className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white">Tus logros</h1>
                <p className="text-sm text-white/70">
                  {earnedCount} de {totalCount} desbloqueados
                </p>
              </div>
            </div>

            <div className="text-right">
              <div className="text-4xl font-bold text-white">
                {completionPct}<span className="text-xl text-white/60">%</span>
              </div>
              <div className="text-xs text-white/60 uppercase tracking-wider font-semibold">
                Completado
              </div>
            </div>
          </div>

          {/* Barra de progreso global */}
          <div className="h-3 bg-black/20 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-gradient-to-r from-yellow-300 via-orange-400 to-pink-500 transition-all duration-1000 ease-out"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} count={totalCount}>
          Todos
        </FilterChip>
        <FilterChip
          active={filter === 'unlocked'}
          onClick={() => setFilter('unlocked')}
          count={earnedCount}
        >
          Desbloqueados
        </FilterChip>
        <FilterChip
          active={filter === 'locked'}
          onClick={() => setFilter('locked')}
          count={totalCount - earnedCount}
        >
          Pendientes
        </FilterChip>
      </div>

      {/* Grupos por rareza */}
      <div className="space-y-8">
        {(['legendary', 'epic', 'rare', 'common'] as const).map((rarity) => {
          const items = filtered[rarity];
          if (items.length === 0) return null;
          const meta = RARITY_META[rarity];

          return (
            <section key={rarity}>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center shadow-lg`}
                >
                  {rarity === 'legendary' && <Crown className="w-4 h-4 text-white" />}
                  {rarity === 'epic' && <Sparkles className="w-4 h-4 text-white" />}
                  {rarity !== 'legendary' && rarity !== 'epic' && (
                    <Trophy className="w-4 h-4 text-white" />
                  )}
                </div>
                <h2 className="text-lg font-bold text-white">{meta.label}</h2>
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-white/50 font-semibold">
                  {items.filter((a) => earnedMap.has(a.id)).length}/{items.length}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {items.map((a) => {
                  const userAch = earnedMap.get(a.id);
                  const isEarned = !!userAch;
                  const progress = isEarned ? null : computeProgress(a);
                  const icon = ICON_MAP[a.name] || '🏆';

                  return (
                    <AchievementCard
                      key={a.id}
                      achievement={a}
                      icon={icon}
                      isEarned={isEarned}
                      earnedAt={userAch?.earned_at}
                      progress={progress}
                      rarityColor={meta.color}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}

        {Object.values(filtered).every((arr) => arr.length === 0) && (
          <div className="text-center py-16 text-white/50">
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No hay logros en esta vista.</p>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes fade-in {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.4s ease-out; }
      `}</style>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-semibold transition border ${
        active
          ? 'bg-white/20 border-white/40 text-white'
          : 'bg-white/5 border-white/15 text-white/60 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
      <span className="ml-1.5 text-xs opacity-70">{count}</span>
    </button>
  );
}

function AchievementCard({
  achievement,
  icon,
  isEarned,
  earnedAt,
  progress,
  rarityColor,
}: {
  achievement: Achievement;
  icon: string;
  isEarned: boolean;
  earnedAt?: string;
  progress: { current: number; target: number; pct: number } | null;
  rarityColor: string;
}) {
  return (
    <div
      className={`relative rounded-2xl p-4 backdrop-blur-xl border transition group ${
        isEarned
          ? 'bg-white/15 border-white/30 hover:bg-white/20 shadow-lg'
          : 'bg-white/5 border-white/10 hover:bg-white/10'
      }`}
      style={
        isEarned
          ? { boxShadow: `0 4px 24px ${rarityColor}30, inset 0 1px 0 rgba(255,255,255,0.15)` }
          : undefined
      }
    >
      {/* Glow halo for earned */}
      {isEarned && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none opacity-30"
          style={{
            background: `radial-gradient(circle at top, ${rarityColor}40, transparent 60%)`,
          }}
        />
      )}

      <div className="relative">
        {/* Icon */}
        <div
          className={`w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center text-2xl transition ${
            isEarned ? 'shadow-lg' : 'grayscale opacity-30'
          }`}
          style={
            isEarned
              ? {
                  background: `linear-gradient(135deg, ${rarityColor}, ${rarityColor}88)`,
                  boxShadow: `0 0 24px ${rarityColor}60`,
                }
              : { background: 'rgba(0,0,0,0.3)' }
          }
        >
          {isEarned ? icon : <Lock className="w-5 h-5 text-white/40" />}
        </div>

        {/* Name */}
        <h3
          className={`text-center text-sm font-bold mb-1 ${
            isEarned ? 'text-white' : 'text-white/40'
          }`}
        >
          {achievement.name}
        </h3>

        {/* Description / progress */}
        {isEarned ? (
          <>
            <p className="text-center text-[11px] text-white/60 line-clamp-2 leading-tight mb-2 min-h-[28px]">
              {achievement.description}
            </p>
            {earnedAt && (
              <div className="text-center text-[10px] text-emerald-300 font-semibold">
                ✓ {new Date(earnedAt).toLocaleDateString('es', { day: 'numeric', month: 'short' })}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-center text-[11px] text-white/40 line-clamp-2 leading-tight mb-2 min-h-[28px]">
              {achievement.description}
            </p>
            {progress && (
              <div className="space-y-1">
                <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${progress.pct}%`,
                      background: `linear-gradient(90deg, ${rarityColor}88, ${rarityColor})`,
                    }}
                  />
                </div>
                <div className="text-center text-[10px] text-white/50 font-semibold">
                  {progress.current.toLocaleString()}/{progress.target.toLocaleString()}
                </div>
              </div>
            )}
          </>
        )}

        {/* Rewards (solo si está earned) */}
        {isEarned && (achievement.reward_coins > 0 || achievement.reward_xp > 0) && (
          <div className="flex items-center justify-center gap-2 mt-2 text-[10px]">
            {achievement.reward_coins > 0 && (
              <span className="text-yellow-300 font-bold">+{achievement.reward_coins}🪙</span>
            )}
            {achievement.reward_xp > 0 && (
              <span className="text-purple-300 font-bold">+{achievement.reward_xp}⚡</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
