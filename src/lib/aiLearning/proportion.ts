// Estadistica minima para MEDIR si un cambio reduce errores sin engañarnos con el azar. Pura y sin dependencias.
//   wilsonInterval: intervalo de confianza de una proporcion (mejor que el normal con muestras pequenas).
//   compareProportions: diferencia entre dos proporciones con intervalo de Newcombe (hibrido de Wilson) y una DECISION conservadora.
//
// Regla de decision (para adoptar un cambio): solo se dice «mejora» si el intervalo de la diferencia queda ENTERO del lado bueno y hay muestra minima en ambos brazos. «Sin evidencia» no es «no sirve»:
// significa que con estos datos no se puede afirmar nada, y hay que medir mas antes de cambiar el comportamiento.

const Z = 1.96;

export interface Interval {
  low: number;
  high: number;
}

export function wilsonInterval(successes: number, n: number, z = Z): Interval | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, (centre - margin) / denom), high: Math.min(1, (centre + margin) / denom) };
}

export type Decision = 'mejora' | 'empeora' | 'sin_evidencia' | 'muestra_insuficiente';

export interface Comparison {
  a: { successes: number; n: number; rate: number | null; ci: Interval | null };
  b: { successes: number; n: number; rate: number | null; ci: Interval | null };
  /** b - a (puntos porcentuales como fraccion). */
  diff: number | null;
  diffCi: Interval | null;
  decision: Decision;
  minPerArm: number;
}

export const MIN_PER_ARM = 30;

/**
 * Compara dos brazos donde «exito» es lo BUENO (p. ej. «la pregunta paso el juez»). b es el brazo con el cambio.
 * Para metricas donde lo bueno es que BAJE (tasa de errores), pasar los errores como exito invertido: successes = n - errores.
 */
export function compareProportions(a: { successes: number; n: number }, b: { successes: number; n: number }, minPerArm = MIN_PER_ARM): Comparison {
  const ia = wilsonInterval(a.successes, a.n);
  const ib = wilsonInterval(b.successes, b.n);
  const ra = a.n ? a.successes / a.n : null;
  const rb = b.n ? b.successes / b.n : null;
  const base: Comparison = { a: { ...a, rate: ra, ci: ia }, b: { ...b, rate: rb, ci: ib }, diff: null, diffCi: null, decision: 'muestra_insuficiente', minPerArm };
  if (!ia || !ib || ra === null || rb === null) return base;
  const diff = rb - ra;
  // Newcombe (1998) metodo 10: combina los intervalos de Wilson de cada brazo.
  const low = diff - Math.sqrt((rb - ib.low) ** 2 + (ia.high - ra) ** 2);
  const high = diff + Math.sqrt((ib.high - rb) ** 2 + (ra - ia.low) ** 2);
  const diffCi = { low, high };
  let decision: Decision;
  if (a.n < minPerArm || b.n < minPerArm) decision = 'muestra_insuficiente';
  else if (low > 0) decision = 'mejora';
  else if (high < 0) decision = 'empeora';
  else decision = 'sin_evidencia';
  return { ...base, diff, diffCi, decision };
}
