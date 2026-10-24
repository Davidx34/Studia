// Estado de la racha de un estudiante, calculado con las MISMAS reglas que _check_and_update_streak_impl (migracion 001):
//   ultima actividad = hoy        -> a salvo, nada que hacer
//   ultima actividad = ayer       -> en riesgo: estudiar hoy suma 1
//   ultima actividad = hace 2 dias -> dia de gracia: estudiar hoy la mantiene (no suma)
//   mas de 2 dias                 -> perdida: estudiar hoy empieza una racha nueva en 1
// La racha cuenta ESTUDIO (responder una pregunta o repasar una flashcard; migracion 071), no abrir la app.
//
// Por que existe: streak_days solo se actualiza al estudiar, asi que un estudiante que lleva dias sin entrar seguiria viendo
// su racha vieja ("15 dias") hasta su proxima respuesta. Aqui se muestra el valor REAL.
// El escudo de racha comprable (shop_items) no se considera: hoy no hay forma de conseguirlo (no hay tienda).

export type StreakState = 'none' | 'safe' | 'at_risk' | 'grace' | 'lost';

export interface StreakStatus {
  state: StreakState;
  // Racha a MOSTRAR: la guardada si sigue viva, 0 si ya se perdio o nunca empezo.
  streak: number;
  // Dias completos desde la ultima actividad (null si nunca hubo).
  daysSince: number | null;
  // Frase corta para la tarjeta de la racha.
  hint: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Fecha civil AAAA-MM-DD de un instante en una zona horaria (la del perfil; la base usa America/Bogota por defecto).
export function localDate(now: Date, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

const dayNumber = (isoDate: string): number => Math.floor(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / DAY_MS);

export function streakStatus(input: { streakDays: number | null | undefined; lastActivityDate: string | null | undefined; today: string }): StreakStatus {
  const stored = Math.max(0, Math.floor(Number(input.streakDays) || 0));
  if (!input.lastActivityDate || stored === 0) {
    return { state: 'none', streak: 0, daysSince: null, hint: 'Responde una pregunta hoy para empezar tu racha' };
  }
  const daysSince = dayNumber(input.today) - dayNumber(input.lastActivityDate);
  if (!Number.isFinite(daysSince) || daysSince < 0) {
    // Fecha rara (reloj o zona distintos): no se inventa nada, se muestra lo guardado como a salvo.
    return { state: 'safe', streak: stored, daysSince: null, hint: 'A salvo por hoy' };
  }
  if (daysSince === 0) return { state: 'safe', streak: stored, daysSince, hint: 'A salvo por hoy' };
  if (daysSince === 1) return { state: 'at_risk', streak: stored, daysSince, hint: 'Estudia hoy para sumar un día' };
  if (daysSince === 2) return { state: 'grace', streak: stored, daysSince, hint: 'Día de gracia: estudia hoy para mantenerla' };
  return { state: 'lost', streak: 0, daysSince, hint: 'Se reinició: estudia hoy para empezar una nueva' };
}
