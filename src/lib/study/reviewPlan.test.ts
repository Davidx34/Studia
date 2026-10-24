import { describe, it, expect } from 'vitest';
import { buildReviewPlan } from './reviewPlan';
import { REVIEW_SESSION_SIZE } from './constants';

const NOW = new Date('2026-10-24T15:00:00Z');
const card = (id: string, materialId = 'm1', classroomId = 'c1') => ({ id, materialId, classroomId });
const past = '2026-10-23T04:00:00Z';
const future = '2026-10-26T04:00:00Z';

describe('buildReviewPlan', () => {
  it('sin tarjetas no hay nada que repasar', () => {
    expect(buildReviewPlan([], [], NOW)).toEqual({ dueTotal: 0, sessionCount: 0, minutes: 0, target: null });
  });

  it('una tarjeta nunca repasada cuenta como pendiente', () => {
    const p = buildReviewPlan([card('a'), card('b')], [], NOW);
    expect(p.dueTotal).toBe(2);
    expect(p.target).toEqual({ classroomId: 'c1', materialId: 'm1', due: 2 });
  });

  it('solo cuentan las vencidas: las programadas a futuro no', () => {
    const p = buildReviewPlan([card('a'), card('b'), card('c')], [{ card_id: 'a', due_at: past }, { card_id: 'b', due_at: future }], NOW);
    expect(p.dueTotal).toBe(2); // a (vencida) y c (nueva)
  });

  it('todo al dia: ninguna pendiente y sin destino', () => {
    const p = buildReviewPlan([card('a')], [{ card_id: 'a', due_at: future }], NOW);
    expect(p).toMatchObject({ dueTotal: 0, sessionCount: 0, minutes: 0, target: null });
  });

  it('la sesion se acota al tamano de sesion pero dueTotal conserva el total', () => {
    const cards = Array.from({ length: 45 }, (_, i) => card(`k${i}`));
    const p = buildReviewPlan(cards, [], NOW);
    expect(p.dueTotal).toBe(45);
    expect(p.sessionCount).toBe(REVIEW_SESSION_SIZE);
  });

  it('estima minutos con un minimo de 1', () => {
    expect(buildReviewPlan([card('a')], [], NOW).minutes).toBe(1);
    const twenty = Array.from({ length: 20 }, (_, i) => card(`k${i}`));
    expect(buildReviewPlan(twenty, [], NOW).minutes).toBe(7); // 20 tarjetas x 20 s = 400 s -> 7 min
  });

  it('el destino es el material con mas pendientes; en empate, el primero', () => {
    const cards = [card('a', 'm1', 'c1'), card('b', 'm2', 'c2'), card('c', 'm2', 'c2'), card('d', 'm1', 'c1')];
    expect(buildReviewPlan(cards, [], NOW).target).toEqual({ classroomId: 'c1', materialId: 'm1', due: 2 });
    const more = [...cards, card('e', 'm2', 'c2')];
    expect(buildReviewPlan(more, [], NOW).target).toEqual({ classroomId: 'c2', materialId: 'm2', due: 3 });
  });
});
