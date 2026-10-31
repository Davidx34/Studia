import type { Tables } from '@/types/database.generated';
import type { AchievementRarity } from '@/types/database';

// Logros tal como los usa la pantalla. La base permite NULL en varias columnas (icono, color, rareza, monedas, orden), pero todas tienen un valor
// por defecto en la migracion 001: una fila con NULL se muestra como si tuviera ese valor, en vez de romper la pantalla.

export interface Achievement {
  id: string;
  name: string;
  description: string | null;
  icon_name: string;
  color: string;
  criteria_type: string;
  criteria_value: number;
  criteria_category: string | null;
  rarity: AchievementRarity;
  reward_coins: number;
  sort_order: number;
}

export interface UserAchievement {
  achievement_id: string;
  earned_at: string;
  seen_by_user: boolean;
}

const RARITIES: readonly AchievementRarity[] = ['common', 'rare', 'epic', 'legendary'];
const isRarity = (v: unknown): v is AchievementRarity => RARITIES.some((r) => r === v);

export function toAchievement(row: Tables<'achievements'>): Achievement {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon_name: row.icon_name ?? 'trophy',
    color: row.color ?? '#FFD700',
    criteria_type: row.criteria_type,
    criteria_value: row.criteria_value,
    criteria_category: row.criteria_category,
    rarity: isRarity(row.rarity) ? row.rarity : 'common',
    reward_coins: row.reward_coins ?? 0,
    sort_order: row.sort_order ?? 0,
  };
}

export function toUserAchievement(row: { achievement_id: string; earned_at: string | null; seen_by_user: boolean | null }): UserAchievement {
  return { achievement_id: row.achievement_id, earned_at: row.earned_at ?? '', seen_by_user: row.seen_by_user ?? false };
}
