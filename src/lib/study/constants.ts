// Constantes compartidas entre el servidor (jobs.ts) y el panel del profesor (panelState.ts). Sin imports: el panel
// corre en el navegador y no debe arrastrar codigo de servidor.

// Una generacion "en curso" mas vieja que esto se considera caida (la funcion se corto por tiempo).
export const STALE_GENERATING_MS = 6 * 60 * 1000;
// Tras un fallo no se reintenta de inmediato (evita martillar al proveedor de IA).
export const RETRY_COOLDOWN_MS = 60 * 1000;
// La funcion vive 300 s: a los 240 s se deja de abrir bloques nuevos y se guarda lo logrado.
export const WORK_BUDGET_MS = 240 * 1000;

// Sesion de repaso de flashcards (Leitner): tarjetas por sesion y tiempo medio por tarjeta para estimar la duracion.
export const REVIEW_SESSION_SIZE = 20;
export const SECONDS_PER_CARD = 20;
