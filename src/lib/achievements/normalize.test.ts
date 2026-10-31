import { describe, it, expect } from 'vitest';
import type { Tables } from '@/types/database.generated';
import { toAchievement, toUserAchievement } from './normalize';

const row = (over: Partial<Tables<'achievements'>> = {}): Tables<'achievements'> => ({
  id: 'a1',
  name: 'Primeros Pasos',
  description: null,
  icon_name: 'footprints',
  color: '#123456',
  criteria_type: 'modules_completed',
  criteria_value: 1,
  criteria_category: null,
  reward_coins: 10,
  rarity: 'rare',
  sort_order: 2,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('toAchievement: la base permite NULL, la pantalla no', () => {
  it('una fila completa pasa tal cual', () => {
    expect(toAchievement(row())).toEqual({
      id: 'a1', name: 'Primeros Pasos', description: null, icon_name: 'footprints', color: '#123456', criteria_type: 'modules_completed',
      criteria_value: 1, criteria_category: null, rarity: 'rare', reward_coins: 10, sort_order: 2,
    });
  });
  it('los NULL toman el valor por defecto de la base (migracion 001)', () => {
    const a = toAchievement(row({ icon_name: null, color: null, rarity: null, reward_coins: null, sort_order: null }));
    expect(a).toMatchObject({ icon_name: 'trophy', color: '#FFD700', rarity: 'common', reward_coins: 0, sort_order: 0 });
  });
  it('una rareza que no existe cae a "common" (nunca rompe el agrupado por rareza)', () => {
    expect(toAchievement(row({ rarity: 'mitica' })).rarity).toBe('common');
    for (const r of ['common', 'rare', 'epic', 'legendary']) expect(toAchievement(row({ rarity: r })).rarity).toBe(r);
  });
});

describe('toUserAchievement', () => {
  it('NULL -> valores seguros', () => {
    expect(toUserAchievement({ achievement_id: 'a1', earned_at: null, seen_by_user: null })).toEqual({ achievement_id: 'a1', earned_at: '', seen_by_user: false });
  });
  it('conserva lo que viene', () => {
    expect(toUserAchievement({ achievement_id: 'a1', earned_at: '2026-02-02T00:00:00Z', seen_by_user: true })).toEqual({ achievement_id: 'a1', earned_at: '2026-02-02T00:00:00Z', seen_by_user: true });
  });
});
