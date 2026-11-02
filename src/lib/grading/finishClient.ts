// Cierre de la leccion desde el navegador: le pide al servidor que cierre el intento y escriba el progreso (POST /api/lesson/finish).
//
//   'ok'          el servidor cerro la leccion y escribio el progreso desde las respuestas verificadas.
//   'rejected'    el servidor la rechazo (quedan preguntas sin responder, el intento no es suyo, no hay nada que calificar...): NO se escribe el progreso a mano.
//   'unavailable' el cierre en el servidor no esta disponible (calificacion apagada, migracion sin aplicar, error del servidor, sin red): el estudiante recibe un AVISO y puede reintentar
//                 (src/lib/grading/saveOutcome.ts). Desde la migracion 086 el navegador ya no escribe el progreso por su cuenta.
export type FinishOutcome = 'ok' | 'rejected' | 'unavailable';

export async function finishLessonOnServer(attemptId: string, elapsedSeconds: number, fetchImpl: typeof fetch = fetch): Promise<FinishOutcome> {
  try {
    const res = await fetchImpl('/api/lesson/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId, elapsedSeconds }),
    });
    if (res.ok) return 'ok';
    // 501/503: la funcion o la calificacion no estan activas. 5xx del servidor: tampoco se sabe nada de la leccion.
    if (res.status === 501 || res.status === 503 || res.status >= 500) return 'unavailable';
    return 'rejected';
  } catch {
    return 'unavailable';
  }
}
