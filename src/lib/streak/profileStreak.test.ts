import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { profileStreak } from './status';

describe('profileStreak', () => {
  // 2026-10-24 15:00 UTC = 10:00 en Bogota
  const now = new Date('2026-10-24T15:00:00Z');

  it('devuelve la racha real de un perfil: viva, o 0 si ya se perdio', () => {
    expect(profileStreak({ streak_days: 6, last_activity_date: '2026-10-23', timezone: 'America/Bogota' }, now)).toMatchObject({ state: 'at_risk', streak: 6 });
    expect(profileStreak({ streak_days: 15, last_activity_date: '2026-10-10', timezone: 'America/Bogota' }, now)).toMatchObject({ state: 'lost', streak: 0 });
  });

  it('un perfil sin racha, sin fecha o sin zona horaria no rompe', () => {
    expect(profileStreak({}, now)).toMatchObject({ state: 'none', streak: 0 });
    expect(profileStreak({ streak_days: null, last_activity_date: null, timezone: null }, now).streak).toBe(0);
    expect(profileStreak({ streak_days: 4, last_activity_date: '2026-10-24', timezone: null }, now)).toMatchObject({ state: 'safe', streak: 4 });
  });

  it('usa la zona horaria DEL ESTUDIANTE para decidir que dia es hoy', () => {
    // A las 02:00 UTC del 25, en Bogota (UTC-5) todavia es 24: actividad el 24 = a salvo; en UTC ya es el 25 = en riesgo.
    const late = new Date('2026-10-25T02:00:00Z');
    expect(profileStreak({ streak_days: 3, last_activity_date: '2026-10-24', timezone: 'America/Bogota' }, late).state).toBe('safe');
    expect(profileStreak({ streak_days: 3, last_activity_date: '2026-10-24', timezone: 'UTC' }, late).state).toBe('at_risk');
  });
});

// Ninguna pantalla del profesor debe mostrar el streak_days GUARDADO: solo cambia cuando el estudiante estudia, asi que un
// estudiante que lleva dias sin entrar seguiria apareciendo con su racha vieja. Se vigila el codigo, quitando antes las listas de
// columnas de los select (donde "streak_days" si debe aparecer).
describe('las pantallas del profesor muestran la racha real', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
  const columnLists = /(['"])[^'"\n]*last_activity_date[^'"\n]*\1/g;
  const withoutSelects = (src: string) => src.replace(columnLists, "''");
  const files = [
    'src/app/(teacher)/teacher/dashboard/page.tsx',
    'src/app/(teacher)/teacher/classrooms/[id]/students/page.tsx',
    'src/app/(teacher)/teacher/students/[studentId]/page.tsx',
    'src/lib/actions/classroom-progress.ts',
  ];

  it('la guarda distingue el código viejo del nuevo (y no pasa por casualidad)', () => {
    const viejo = "supabase.from('profiles').select('id, streak_days, last_activity_date')\n<div>Racha de {s.streak_days} días</div>\n.sort((a, b) => (b.streak_days ?? 0) - (a.streak_days ?? 0))";
    const nuevo = "supabase.from('profiles').select('id, streak_days, last_activity_date, timezone')\n<div>Racha de {profileStreak(s).streak} días</div>";
    expect(withoutSelects(viejo)).toContain('streak_days');
    expect(withoutSelects(nuevo)).not.toContain('streak_days');
    // Los select con comillas dobles, y los de varias columnas en una sola línea, también se descuentan.
    expect(withoutSelects('.select("id, last_activity_date, streak_days")')).not.toContain('streak_days');
  });

  it.each(files)('%s usa profileStreak y no lee streak_days fuera de los select', (f) => {
    const src = read(f);
    expect(src).toContain('profileStreak');
    expect(withoutSelects(src)).not.toContain('streak_days');
  });
});
