// Repaso espaciado por cajas de Leitner. Sin dependencias: se prueba como funcion pura.

export type Grade = 'again' | 'hard' | 'good';

// Dias hasta el proximo repaso por caja (caja 1 = en esta misma sesion).
export const BOX_INTERVAL_DAYS: Record<number, number> = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 21 };
export const MAX_BOX = 5;

export interface CardState {
  box: number;
  reviews: number;
  lapses: number;
}

export interface NextState extends CardState {
  due_at: string;
  last_reviewed_at: string;
}

export function nextState(prev: CardState | null, grade: Grade, now: Date = new Date()): NextState {
  const base: CardState = prev ?? { box: 1, reviews: 0, lapses: 0 };
  let box = base.box;
  let lapses = base.lapses;
  if (grade === 'again') {
    box = 1;
    lapses += 1;
  } else if (grade === 'good') {
    box = Math.min(MAX_BOX, box + 1);
  } // 'hard': se queda en su caja

  const days = BOX_INTERVAL_DAYS[box] ?? 0;
  // "No lo sabia" vuelve a salir en esta misma sesion (10 minutos); el resto, a las 4 de la manana del dia que toca
  // para que no dependa de la hora exacta en que repaso.
  const due = new Date(now);
  if (grade === 'again' || days === 0) {
    due.setMinutes(due.getMinutes() + 10);
  } else {
    due.setDate(due.getDate() + days);
    due.setHours(4, 0, 0, 0);
  }
  return { box, reviews: base.reviews + 1, lapses, due_at: due.toISOString(), last_reviewed_at: now.toISOString() };
}

export function isDue(state: { due_at: string } | null | undefined, now: Date = new Date()): boolean {
  if (!state) return true; // nunca repasada = pendiente
  return new Date(state.due_at).getTime() <= now.getTime();
}
