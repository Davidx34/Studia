import { describe, expect, it } from 'vitest';
import { compareProportions, wilsonInterval } from './proportion';

describe('wilsonInterval', () => {
  it('es null sin datos y siempre queda dentro de [0,1]', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const i0 = wilsonInterval(0, 10)!;
    const i1 = wilsonInterval(10, 10)!;
    expect(i0.low).toBe(0);
    expect(i1.high).toBe(1);
    expect(i1.low).toBeGreaterThan(0.6);
  });
  it('valor conocido: 50 de 100 -> aprox. [0.404, 0.596]', () => {
    const i = wilsonInterval(50, 100)!;
    expect(i.low).toBeCloseTo(0.404, 2);
    expect(i.high).toBeCloseTo(0.596, 2);
  });
  it('se estrecha al crecer la muestra', () => {
    const a = wilsonInterval(5, 10)!;
    const b = wilsonInterval(500, 1000)!;
    expect(b.high - b.low).toBeLessThan(a.high - a.low);
  });
});

describe('compareProportions', () => {
  it('con muestra menor al minimo NO decide, aunque la diferencia sea enorme', () => {
    const c = compareProportions({ successes: 2, n: 10 }, { successes: 9, n: 10 });
    expect(c.decision).toBe('muestra_insuficiente');
    expect(c.diff).toBeCloseTo(0.7, 5);
  });
  it('una mejora clara con muestra suficiente es «mejora»', () => {
    const c = compareProportions({ successes: 40, n: 100 }, { successes: 70, n: 100 });
    expect(c.decision).toBe('mejora');
    expect(c.diffCi!.low).toBeGreaterThan(0);
  });
  it('una diferencia pequena con ruido es «sin_evidencia» (no «no sirve»)', () => {
    const c = compareProportions({ successes: 50, n: 100 }, { successes: 56, n: 100 });
    expect(c.decision).toBe('sin_evidencia');
    expect(c.diffCi!.low).toBeLessThan(0);
    expect(c.diffCi!.high).toBeGreaterThan(0);
  });
  it('detecta cuando el cambio EMPEORA', () => {
    expect(compareProportions({ successes: 80, n: 100 }, { successes: 50, n: 100 }).decision).toBe('empeora');
  });
  it('iguales -> diferencia 0 y sin evidencia', () => {
    const c = compareProportions({ successes: 30, n: 60 }, { successes: 30, n: 60 });
    expect(c.diff).toBe(0);
    expect(c.decision).toBe('sin_evidencia');
  });
  it('sin datos en un brazo devuelve muestra_insuficiente sin lanzar', () => {
    expect(compareProportions({ successes: 0, n: 0 }, { successes: 5, n: 10 }).decision).toBe('muestra_insuficiente');
  });
});
