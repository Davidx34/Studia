// Que le pasa al RESULTADO de una leccion al terminarla y que se le dice al estudiante. Funcion pura con dependencias inyectadas (sin red ni React) para poder probarla.
//
// Desde la migracion 086 el navegador NO escribe el progreso: lo cierra el servidor (finish_lesson). Si el cierre falla, el estudiante lo tiene que saber: antes el respaldo de escritura
// directa fallaba en silencio y terminaba una leccion sin que su resultado contara y sin enterarse.
//
//   'saved'       el servidor cerro la leccion y escribio el progreso.
//   'retry'       el servidor no estuvo disponible (corte de red, error momentaneo): se puede reintentar. Cerrar es idempotente: reintentar no suma dos veces.
//   'unrecorded'  no hay nada que cerrar (no se creo un intento en el servidor) o el servidor lo rechazo: reintentar no ayuda.

import type { FinishOutcome } from './finishClient';

export type SaveOutcome = 'saved' | 'retry' | 'unrecorded';

export const outcomeOf = (finish: FinishOutcome): SaveOutcome => (finish === 'ok' ? 'saved' : finish === 'rejected' ? 'unrecorded' : 'retry');

// Lo que la pantalla final muestra. null = nada que avisar.
export interface SaveNotice {
  canRetry: boolean;
}
export const noticeFor = (o: SaveOutcome): SaveNotice | null => (o === 'saved' ? null : { canRetry: o === 'retry' });

export interface CloseDeps {
  finish: (attemptId: string, elapsedSeconds: number) => Promise<FinishOutcome>;
  seconds: () => number;
  wait: (ms: number) => Promise<void>;
  // Se ejecuta SOLO si el resultado quedo guardado (p. ej. evaluar logros). Un fallo aqui no deshace lo guardado.
  onSaved?: () => Promise<unknown>;
  onError?: (e: unknown) => void;
}

export const AUTO_RETRY_WAIT_MS = 1200;

export async function closeLesson(attemptId: string | null, deps: CloseDeps): Promise<SaveOutcome> {
  try {
    if (!attemptId) return 'unrecorded';
    let finish = await deps.finish(attemptId, deps.seconds());
    if (finish === 'unavailable') {
      // Un reintento automatico antes de molestar al estudiante.
      await deps.wait(AUTO_RETRY_WAIT_MS);
      finish = await deps.finish(attemptId, deps.seconds());
    }
    const outcome = outcomeOf(finish);
    if (outcome === 'saved' && deps.onSaved) {
      try {
        await deps.onSaved();
      } catch (e) {
        deps.onError?.(e); // el progreso ya esta guardado: un fallo de logros no lo convierte en "no guardado"
      }
    }
    return outcome;
  } catch (e) {
    deps.onError?.(e);
    return 'retry';
  }
}
