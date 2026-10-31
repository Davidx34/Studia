// Contrato de los minijuegos con la calificacion en el servidor (fase 4(a) de docs/PLAN_CALIFICACION_EN_SERVIDOR.md).
//
// Con `check`, el juego NO conoce la solucion: manda lo que el jugador eligio y espera el veredicto del servidor, que trae lo que hay que revelar (la solucion, las
// consecuencias y la explicacion). Sin `check` el juego se comporta como siempre (los datos traen la solucion y se califica en el navegador).

export interface GameVerdict {
  correct: boolean;
  // Lo que el servidor revela al cerrar la pregunta (depende del juego; ver buildGameReveal en src/lib/grading/gameGrading.ts).
  reveal?: Record<string, unknown>;
  explanation?: string | null;
}

// null = no se pudo comprobar (sin conexion, sesion vencida, intento cerrado...): el juego deja volver a intentarlo.
export type GameCheck = (answer: unknown) => Promise<GameVerdict | null>;

export const CHECK_ERROR = 'No se pudo comprobar tu respuesta. Revisa tu conexión e inténtalo de nuevo.';

export const idList = (v: unknown): (string | number)[] => (Array.isArray(v) ? v.filter((x): x is string | number => typeof x === 'string' || typeof x === 'number') : []);
export const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
