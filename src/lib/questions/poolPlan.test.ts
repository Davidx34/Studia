import { describe, it, expect } from 'vitest';
import { countServable, planFill, resolveQuestionCount } from './poolPlan';

const row = (is_backup: boolean, review_status = 'approved') => ({ is_backup, review_status });

describe('resolveQuestionCount', () => {
  it('usa 10 por defecto y acota entre 5 y 15', () => {
    expect(resolveQuestionCount(null)).toBe(10);
    expect(resolveQuestionCount(undefined)).toBe(10);
    expect(resolveQuestionCount(0)).toBe(10);
    expect(resolveQuestionCount(3)).toBe(5);
    expect(resolveQuestionCount(99)).toBe(15);
    expect(resolveQuestionCount(8)).toBe(8);
  });
});

describe('countServable', () => {
  it('separa activas y reserva', () => {
    expect(countServable([row(false), row(false), row(true)])).toEqual({ active: 2, backup: 1 });
  });

  it('una pregunta rechazada NO cuenta como pool', () => {
    expect(countServable([row(false, 'rejected'), row(true, 'rejected'), row(false, 'pending')])).toEqual({ active: 1, backup: 0 });
  });

  it('pendientes y en revision humana si cuentan (se sirven)', () => {
    expect(countServable([row(false, 'pending'), row(true, 'human_review')])).toEqual({ active: 1, backup: 1 });
  });

  it('sin filas: pool vacio', () => {
    expect(countServable([])).toEqual({ active: 0, backup: 0 });
  });
});

describe('planFill', () => {
  it('modulo vacio: faltan activas y reserva completas', () => {
    expect(planFill(10, { active: 0, backup: 0 })).toEqual({ needActive: 10, needBackup: 10, complete: false });
  });

  it('solo pide lo que falta', () => {
    expect(planFill(10, { active: 7, backup: 10 })).toEqual({ needActive: 3, needBackup: 0, complete: false });
    expect(planFill(10, { active: 10, backup: 4 })).toEqual({ needActive: 0, needBackup: 6, complete: false });
  });

  it('pool completo (o de sobra): no falta nada', () => {
    expect(planFill(10, { active: 10, backup: 10 })).toEqual({ needActive: 0, needBackup: 0, complete: true });
    expect(planFill(5, { active: 12, backup: 9 }).complete).toBe(true);
  });

  it('nunca da cantidades negativas', () => {
    const p = planFill(5, { active: 50, backup: 50 });
    expect(p.needActive).toBe(0);
    expect(p.needBackup).toBe(0);
  });
});
