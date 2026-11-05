import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { isMastered, isRetry } from './mastery';

describe('isMastered / isRetry', () => {
  it('solo terminado con 100 % esta dominado', () => {
    expect(isMastered({ status: 'completed', best_score: 100 })).toBe(true);
    expect(isMastered({ status: 'completed', best_score: '100' })).toBe(true);
    for (const s of [99.9, 40, 0, null, undefined]) expect(isMastered({ status: 'completed', best_score: s as any }), String(s)).toBe(false);
    expect(isMastered({ status: 'in_progress', best_score: 100 })).toBe(false);
    expect(isMastered(null)).toBe(false);
    expect(isMastered(undefined)).toBe(false);
  });
  it('terminado sin dominar = repetir; lo dominado o en curso no', () => {
    expect(isRetry({ status: 'completed', best_score: 40 })).toBe(true);
    expect(isRetry({ status: 'completed', best_score: 100 })).toBe(false);
    expect(isRetry({ status: 'in_progress', best_score: 40 })).toBe(false);
    expect(isRetry(undefined)).toBe(false);
  });
});

describe('las pantallas del estudiante usan la misma definicion', () => {
  const read = (p: string) => fs.readFileSync(p, 'utf8');
  it('pagina de la clase', () => {
    const c = read('src/app/(student)/my-classes/[id]/page.tsx');
    expect(c).toContain("import { isMastered, isRetry } from '@/lib/progress/mastery';");
    expect(c).toContain('.filter((p: any) => isMastered(p)).length');
    expect(c).toContain('!isMastered(prevProgress)');
    expect(c).toContain('const isCompleted = isMastered(progress);');
    expect(c).toContain("const isInProgress = progress?.status === 'in_progress' || isRetry(progress);");
  });
  it('panel: el total y las clases cuentan solo dominados', () => {
    const c = read('src/app/(student)/dashboard/page.tsx');
    expect(c.match(/\.gte\('best_score', 100\)/g)?.length).toBe(2);
  });
  it('el mapa usa el helper', () => {
    const c = read('src/lib/map/mapSections.ts');
    expect(c).toContain("from '@/lib/progress/mastery'");
  });
});
