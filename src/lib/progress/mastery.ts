// «Dominado» = lo que cuenta para avanzar: el modulo esta terminado Y su mejor nota es 100 %. (`finish_lesson` marca 'completed' con cualquier nota; la nota maxima queda en best_score.)
// Una sola definicion para el mapa, la pagina de la clase y el panel del estudiante.
export const MASTERY_SCORE = 100;

export function isMastered(p: { status?: string | null; best_score?: number | string | null } | null | undefined): boolean {
  return p?.status === 'completed' && Number(p.best_score ?? 0) >= MASTERY_SCORE;
}

// Terminado pero sin dominar: se muestra «en curso» (hay que repetirlo).
export function isRetry(p: { status?: string | null; best_score?: number | string | null } | null | undefined): boolean {
  return p?.status === 'completed' && !isMastered(p);
}
