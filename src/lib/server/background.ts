// Trabajo en segundo plano de una funcion serverless.
//
// En Vercel, cuando la respuesta ya salio la funcion normalmente se congela y el trabajo pendiente se pierde.
// waitUntil le dice a la plataforma "sigue viva hasta que esta promesa termine" (con el tope de maxDuration de la
// ruta). Asi la subida de un PDF responde al instante y la conversion (1-3 min) sigue sola.
//
// Fuera de Vercel (desarrollo local, pruebas) waitUntil no hace nada util, pero la promesa ya esta corriendo y
// Node la deja terminar: funciona igual.

import { waitUntil } from '@vercel/functions';

type WaitUntil = (promise: Promise<unknown>) => void;

export function runInBackground(work: Promise<unknown>, wait: WaitUntil = waitUntil): void {
  // Un fallo del trabajo no debe tumbar la respuesta ni quedar sin manejar: quien lo lanza ya registra su propio error.
  const safe = work.catch((e) => {
    console.error('[background] el trabajo en segundo plano fallo:', e);
  });
  try {
    wait(safe);
  } catch (e) {
    // Sin contexto de plataforma: la promesa sigue corriendo por su cuenta.
    console.warn('[background] waitUntil no disponible:', (e as Error)?.message);
  }
}
