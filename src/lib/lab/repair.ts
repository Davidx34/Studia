// Ajuste MECANICO de rangos cuando un modelo falla solo en el BORDE de una variable (por ejemplo "1/x" con x desde 0). Es lo mas comun cuando la IA elige un rango que llega
// justo donde una formula se indefine. Se acorta ese extremo un paso hacia adentro y se avisa; nada mas se toca. Si el fallo no esta en un borde, no se arregla aqui (se le
// devuelve el error a la IA). Sin red.

import { validateModel, type ProbeFailure } from './model';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (n: number) => String(Number(n.toPrecision(4)));

export const REPAIR_ROUNDS = 6;

// Un paso hacia adentro en cada extremo donde fallo algo. null si no hay nada que ajustar o el rango quedaria demasiado corto.
export function trimRanges(model: Record<string, unknown>, failures: ProbeFailure[]): { model: Record<string, unknown>; notes: string[] } | null {
  if (!Array.isArray(model.variables)) return null;
  const notes: string[] = [];
  let changed = false;
  const variables = model.variables.map((v) => {
    if (!isObj(v) || typeof v.id !== 'string') return v;
    const id = v.id;
    const min = num(v.min);
    const max = num(v.max);
    if (min === null || max === null || min >= max) return v;
    const step = (num(v.step) ?? 0) > 0 ? (num(v.step) as number) : Number(((max - min) / 100).toPrecision(2));
    const atMin = failures.some((f) => f.values[id] === min);
    const atMax = failures.some((f) => f.values[id] === max);
    if (!atMin && !atMax) return v;
    const nmin = atMin ? min + step : min;
    const nmax = atMax ? max - step : max;
    if (nmax - nmin < 2 * step) return v;
    changed = true;
    if (atMin) notes.push(`Se acortó el mínimo de "${id}" a ${fmt(nmin)} para evitar valores donde una fórmula se indefine.`);
    if (atMax) notes.push(`Se acortó el máximo de "${id}" a ${fmt(nmax)} para evitar valores donde una fórmula se indefine.`);
    return { ...v, min: nmin, max: nmax, ...(num(v.default) !== null ? { default: Math.min(nmax, Math.max(nmin, num(v.default) as number)) } : {}) };
  });
  return changed ? { model: { ...model, variables }, notes } : null;
}

// Valida y, mientras el fallo este en un borde, acorta el rango (hasta REPAIR_ROUNDS veces). Devuelve el modelo (posiblemente ajustado) y los avisos.
export function repairModel(model: unknown): { model: unknown; notes: string[] } {
  if (!isObj(model)) return { model, notes: [] };
  let current: Record<string, unknown> = model;
  const notes: string[] = [];
  for (let i = 0; i < REPAIR_ROUNDS; i++) {
    const r = validateModel(current);
    if (r.ok || !r.failures || r.failures.length === 0) break;
    const t = trimRanges(current, r.failures);
    if (!t) break;
    current = t.model;
    t.notes.forEach((n) => notes.indexOf(n) === -1 && notes.push(n));
  }
  // Solo se conserva el ajuste si de verdad arregla el modelo.
  return validateModel(current).ok ? { model: current, notes: dedupeTrailing(notes) } : { model, notes: [] };
}

// Si el mismo extremo se acorto varias veces, queda el aviso del ultimo valor de cada variable.
function dedupeTrailing(notes: string[]): string[] {
  const last: Record<string, string> = {};
  const order: string[] = [];
  notes.forEach((n) => {
    const m = n.match(/el (mínimo|máximo) de "([^"]+)"/);
    const k = m ? m[1] + m[2] : n;
    if (!(k in last)) order.push(k);
    last[k] = n;
  });
  return order.map((k) => last[k]);
}
