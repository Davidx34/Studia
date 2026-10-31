'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trophy, Lock, Sparkles, Crown, Check } from 'lucide-react';
import { ProgressBar } from '@/components/ui/ProgressBar';

import type { Achievement, UserAchievement } from '@/lib/achievements/normalize';

interface Props {
  allAchievements: Achievement[];
  userAchievements: UserAchievement[];
  progressContext: {
    streakDays: number;
    modulesCompleted: number;
    perfectScores: number;
    categoryCompleted: Record<string, number>;
  };
}

// El color de rareza es un acento decorativo (borde, medalla). La rareza SIEMPRE se dice tambien con texto y con un icono distinto.
const RARITY_META: Record<string, { label: string; color: string; order: number }> = {
  common: { label: 'Común', color: '#94a3b8', order: 0 },
  rare: { label: 'Raro', color: '#3b82f6', order: 1 },
  epic: { label: 'Épico', color: '#a855f7', order: 2 },
  legendary: { label: 'Legendario', color: '#fbbf24', order: 3 },
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
      pct: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
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
    <div className="theme-scope space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 min-h-[44px] text-sm text-fg-muted hover:text-fg transition motion-reduce:transition-none"
      >
        <ArrowLeft aria-hidden="true" className="w-4 h-4" />
        Volver al inicio
      </Link>

      {/* Hero header con progreso global */}
      <div className="bg-surface border border-line rounded-3xl p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-accent text-on-accent">
              <Trophy aria-hidden="true" className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-fg">Tus logros</h1>
              <p className="text-sm text-fg-muted">
                {earnedCount} de {totalCount} desbloqueados
              </p>
            </div>
          </div>

          <div className="text-right">
            <div className="text-4xl font-bold text-fg font-mono tabular-nums">
              {completionPct}
              <span className="text-xl text-fg-muted">%</span>
            </div>
            <div className="text-xs text-fg-muted uppercase tracking-wider font-semibold">Completado</div>
          </div>
        </div>

        <ProgressBar value={completionPct} label="Logros desbloqueados" tone="accent" className="h-3" />
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filtrar logros">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} count={totalCount}>
          Todos
        </FilterChip>
        <FilterChip active={filter === 'unlocked'} onClick={() => setFilter('unlocked')} count={earnedCount}>
          Desbloqueados
        </FilterChip>
        <FilterChip active={filter === 'locked'} onClick={() => setFilter('locked')} count={totalCount - earnedCount}>
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
            <section key={rarity} aria-labelledby={`rareza-${rarity}`}>
              <div className="flex items-center gap-3 mb-4">
                <div
                  aria-hidden="true"
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: meta.color, color: '#0f172a' }}
                >
                  {rarity === 'legendary' && <Crown className="w-4 h-4" />}
                  {rarity === 'epic' && <Sparkles className="w-4 h-4" />}
                  {rarity !== 'legendary' && rarity !== 'epic' && <Trophy className="w-4 h-4" />}
                </div>
                <h2 id={`rareza-${rarity}`} className="text-lg font-bold text-fg">{meta.label}</h2>
                <div aria-hidden="true" className="flex-1 h-px bg-line" />
                <span className="text-xs text-fg-muted font-semibold">
                  {items.filter((a) => earnedMap.has(a.id)).length}/{items.length}
                </span>
              </div>

              <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {items.map((a) => {
                  const userAch = earnedMap.get(a.id);
                  const isEarned = !!userAch;
                  const progress = isEarned ? null : computeProgress(a);
                  const icon = ICON_MAP[a.name] || '🏆';

                  return (
                    <li key={a.id}>
                      <AchievementCard
                        achievement={a}
                        icon={icon}
                        isEarned={isEarned}
                        earnedAt={userAch?.earned_at}
                        progress={progress}
                        rarityColor={meta.color}
                        rarityLabel={meta.label}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {Object.values(filtered).every((arr) => arr.length === 0) && (
          <div className="text-center py-16 text-fg-muted">
            <Trophy aria-hidden="true" className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>No hay logros en esta vista.</p>
          </div>
        )}
      </div>
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold transition motion-reduce:transition-none border ${
        active
          ? 'bg-primary border-primary text-on-primary'
          : 'bg-surface border-line text-fg-muted hover:text-fg hover:border-line-strong'
      }`}
    >
      {children}
      <span className="ml-1.5 text-xs opacity-80">{count}</span>
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
  rarityLabel,
}: {
  achievement: Achievement;
  icon: string;
  isEarned: boolean;
  earnedAt?: string;
  progress: { current: number; target: number; pct: number } | null;
  rarityColor: string;
  rarityLabel: string;
}) {
  return (
    <article
      className={`h-full rounded-2xl p-4 border-2 ${isEarned ? 'bg-surface' : 'bg-surface-2 border-line'}`}
      style={isEarned ? { borderColor: rarityColor } : undefined}
    >
      {/* Icono: medalla si esta ganado, candado si no */}
      <div
        aria-hidden="true"
        className={`w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center text-2xl ${isEarned ? '' : 'bg-surface border border-line'}`}
        style={isEarned ? { background: rarityColor } : undefined}
      >
        {isEarned ? icon : <Lock className="w-5 h-5 text-fg-muted" />}
      </div>

      <h3 className="text-center text-sm font-bold mb-1 text-fg">{achievement.name}</h3>
      <p className="text-center text-xs text-fg-muted leading-snug mb-2 min-h-[32px]">{achievement.description}</p>

      {isEarned ? (
        <div className="flex items-center justify-center gap-1 text-xs text-success font-semibold">
          <Check aria-hidden="true" className="w-3.5 h-3.5" />
          Desbloqueado{earnedAt ? ` · ${new Date(earnedAt).toLocaleDateString('es', { day: 'numeric', month: 'short' })}` : ''}
        </div>
      ) : (
        progress && (
          <div className="space-y-1">
            <ProgressBar value={progress.pct} label={`Progreso de ${achievement.name}`} tone="primary" className="h-1.5" />
            <div className="text-center text-xs text-fg-muted font-semibold">
              {progress.current.toLocaleString()}/{progress.target.toLocaleString()}
            </div>
          </div>
        )
      )}

      <p className="sr-only">Rareza: {rarityLabel}</p>

      {/* Recompensas (solo si esta ganado) */}
      {isEarned && achievement.reward_coins > 0 && (
        <div className="flex items-center justify-center gap-2 mt-2 text-xs font-bold">
          {achievement.reward_coins > 0 && <span className="text-accent-text">+{achievement.reward_coins} 🪙</span>}
        </div>
      )}
    </article>
  );
}
