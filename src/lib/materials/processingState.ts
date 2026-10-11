// Un procesamiento en segundo plano puede morir sin avisar (la funcion se corta por tiempo o la plataforma la
// reinicia): la fila se queda en "pending"/"processing" para siempre. Si lleva mas que el limite del procesamiento
// (PROCESSING_STALE_MS, el mismo que permite volver a reclamarlo en el servidor), la interfaz lo da por interrumpido
// y ofrece reintentar en lugar de mostrar "Procesando…" eternamente.

import { PROCESSING_STALE_MS } from '@/lib/security/materialGuards';

export function isStalledProcessing(
  status: string | null | undefined,
  startedAt: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (status !== 'pending' && status !== 'processing') return false;
  if (!startedAt) return false; // sin marca de inicio (filas viejas): no se puede afirmar nada
  const age = now - new Date(startedAt).getTime();
  return Number.isFinite(age) && age > PROCESSING_STALE_MS;
}
