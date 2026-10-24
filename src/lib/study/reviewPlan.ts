// "Repaso de hoy": cuantas flashcards le toca repasar hoy a un estudiante y por donde empezar.
// Funcion pura (sin red): el servidor le pasa las tarjetas de sus clases y su avance de Leitner.

import { isDue } from './leitner';
import { REVIEW_SESSION_SIZE, SECONDS_PER_CARD } from './constants';

export interface PlanCard {
  id: string;
  materialId: string;
  classroomId: string;
}

export interface PlanState {
  card_id: string;
  due_at: string;
}

export interface ReviewTarget {
  classroomId: string;
  materialId: string;
  // Tarjetas pendientes de ESE material.
  due: number;
}

export interface ReviewPlan {
  // Todas las pendientes (una tarjeta nunca repasada cuenta como pendiente).
  dueTotal: number;
  // Las que entran en una sesion.
  sessionCount: number;
  // Minutos estimados de la sesion (al menos 1 si hay algo que repasar).
  minutes: number;
  // El material con mas pendientes: ahi abre el enlace. null si no hay nada pendiente.
  target: ReviewTarget | null;
}

export function buildReviewPlan(cards: PlanCard[], states: PlanState[], now: Date = new Date(), sessionSize: number = REVIEW_SESSION_SIZE): ReviewPlan {
  const stateById = new Map(states.map((s) => [s.card_id, s]));
  const dueByMaterial = new Map<string, ReviewTarget>();
  let dueTotal = 0;
  for (const c of cards) {
    if (!isDue(stateById.get(c.id), now)) continue;
    dueTotal += 1;
    const t = dueByMaterial.get(c.materialId);
    if (t) t.due += 1;
    else dueByMaterial.set(c.materialId, { classroomId: c.classroomId, materialId: c.materialId, due: 1 });
  }
  let target: ReviewTarget | null = null;
  // Empate: gana el primero que aparece (orden de las tarjetas), para que el resultado sea estable.
  for (const t of Array.from(dueByMaterial.values())) if (!target || t.due > target.due) target = t;
  const sessionCount = Math.min(dueTotal, sessionSize);
  const minutes = sessionCount === 0 ? 0 : Math.max(1, Math.ceil((sessionCount * SECONDS_PER_CARD) / 60));
  return { dueTotal, sessionCount, minutes, target };
}
