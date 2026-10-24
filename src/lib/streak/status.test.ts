import { describe, it, expect } from 'vitest';
import { localDate, streakStatus } from './status';

const T = '2026-10-24';

describe('streakStatus (mismas reglas que la base)', () => {
  it('sin racha o sin actividad: none y 0', () => {
    expect(streakStatus({ streakDays: 0, lastActivityDate: T, today: T })).toMatchObject({ state: 'none', streak: 0 });
    expect(streakStatus({ streakDays: 5, lastActivityDate: null, today: T })).toMatchObject({ state: 'none', streak: 0 });
    expect(streakStatus({ streakDays: null, lastActivityDate: undefined, today: T })).toMatchObject({ state: 'none', streak: 0 });
  });

  it('actividad hoy: a salvo', () => {
    expect(streakStatus({ streakDays: 6, lastActivityDate: '2026-10-24', today: T })).toMatchObject({ state: 'safe', streak: 6, daysSince: 0 });
  });

  it('actividad ayer: en riesgo, conserva la racha', () => {
    expect(streakStatus({ streakDays: 6, lastActivityDate: '2026-10-23', today: T })).toMatchObject({ state: 'at_risk', streak: 6, daysSince: 1 });
  });

  it('hace 2 días: día de gracia, la racha sigue viva', () => {
    expect(streakStatus({ streakDays: 8, lastActivityDate: '2026-10-22', today: T })).toMatchObject({ state: 'grace', streak: 8, daysSince: 2 });
  });

  it('hace más de 2 días: perdida, se muestra 0 (no el número viejo)', () => {
    expect(streakStatus({ streakDays: 15, lastActivityDate: '2026-10-21', today: T })).toMatchObject({ state: 'lost', streak: 0, daysSince: 3 });
    expect(streakStatus({ streakDays: 15, lastActivityDate: '2026-09-01', today: T })).toMatchObject({ state: 'lost', streak: 0 });
  });

  it('cruza el cambio de mes y de año sin errores', () => {
    expect(streakStatus({ streakDays: 4, lastActivityDate: '2026-09-30', today: '2026-10-01' })).toMatchObject({ state: 'at_risk' });
    expect(streakStatus({ streakDays: 4, lastActivityDate: '2026-12-31', today: '2027-01-02' })).toMatchObject({ state: 'grace' });
  });

  it('una fecha futura (reloj raro) no inventa pérdidas', () => {
    expect(streakStatus({ streakDays: 3, lastActivityDate: '2026-10-26', today: T })).toMatchObject({ state: 'safe', streak: 3 });
  });

  it('acepta marcas de tiempo completas en la última actividad', () => {
    expect(streakStatus({ streakDays: 2, lastActivityDate: '2026-10-23T05:00:00Z', today: T })).toMatchObject({ state: 'at_risk' });
  });
});

describe('localDate', () => {
  it('usa la zona del perfil: a las 02:00 UTC del 25 en Bogotá todavía es 24', () => {
    const d = new Date('2026-10-25T02:00:00Z');
    expect(localDate(d, 'America/Bogota')).toBe('2026-10-24');
    expect(localDate(d, 'UTC')).toBe('2026-10-25');
  });

  it('sin zona o con una zona inválida cae a Bogotá', () => {
    const d = new Date('2026-10-25T02:00:00Z');
    expect(localDate(d, null)).toBe('2026-10-24');
    expect(localDate(d, 'Zona/Inexistente')).toBe('2026-10-24');
  });
});
