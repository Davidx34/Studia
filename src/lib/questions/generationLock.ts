// Lock optimista para evitar cache stampede en generación de preguntas.
// Patrón: solo una generación por módulo puede estar en curso simultáneamente.
//
// Historia (2026-09-19): este bloqueo estuvo ROTO en produccion dos veces, sin
// que nadie lo notara, y las dos veces daba el mismo sintoma (un estudiante abre
// un modulo nuevo y ve "No pude preparar esta leccion"):
//
//  1. La migracion 041 (columna is_generating) nunca se aplico. El UPDATE fallaba
//     con PGRST204, la funcion devolvia `false` y la ruta lo leia como "otra
//     generacion en curso". Se arreglo con la migracion 046.
//
//  2. Aun con la columna, el bloqueo se tomaba con un UPDATE directo sobre
//     content_modules desde la sesion del ESTUDIANTE, y un estudiante solo puede
//     LEER esa tabla. Con RLS un UPDATE que no puede ver la fila no da error:
//     afecta 0 filas, y "0 filas" se leia como "ocupado". Nadie podia tomar el
//     bloqueo: 202 sin fin. Se arreglo pasandolo a funciones SQL SECURITY DEFINER
//     (migracion 047) que comprueban que quien llama es el profesor del modulo o
//     un estudiante inscrito.
//
//     La primera correccion se "verifico" con la llave de administrador, que se
//     salta el RLS, y dio un falso "funciona". Este bloqueo solo se puede probar
//     de verdad como estudiante (ver la nota en la migracion 047).
//
// Lo que este modulo hace para que no se repita:
//   - Distingue "ocupado" (otra generacion legitima) de "no disponible" (el
//     bloqueo mismo esta roto). Un bloqueo roto NO impide generar: se avisa en el
//     log y se sigue sin bloqueo. Peor es no generar nunca.
//   - El bloqueo CADUCA, para que un timeout no deje un modulo bloqueado siempre.
//   - Solo libera quien lo tomo.

export type LockResult = 'acquired' | 'busy' | 'forbidden' | 'unavailable';

// Mas que el tiempo razonable de una generacion (37-67 s medidos, ~110 s si Cohere
// reintenta), pero corto para que un modulo abandonado se libere pronto. La base
// lo acota entre 60 y 600 s.
export const LOCK_TTL_MS = 3 * 60 * 1000;

export async function acquireGenerationLock(supabase: any, moduleId: string): Promise<LockResult> {
  const { data, error } = await supabase.rpc('acquire_generation_lock', {
    p_module_id: moduleId,
    p_ttl_seconds: Math.round(LOCK_TTL_MS / 1000),
  });

  if (error) {
    console.error('[GENERATION_LOCK_UNAVAILABLE]', { moduleId, code: error.code, message: error.message });
    return 'unavailable';
  }

  if (data === 'acquired' || data === 'busy' || data === 'forbidden') return data;

  // Una respuesta que la funcion nunca devuelve: tratarla como bloqueo roto, no como ocupado.
  console.error('[GENERATION_LOCK_UNEXPECTED]', { moduleId, data });
  return 'unavailable';
}

export async function releaseGenerationLock(supabase: any, moduleId: string): Promise<void> {
  const { error } = await supabase.rpc('release_generation_lock', { p_module_id: moduleId });
  if (error) console.error('[GENERATION_LOCK_RELEASE_FAILED]', { moduleId, code: error.code, message: error.message });
}

export type LockOutcome<T> = { status: 'ok'; value: T } | { status: 'busy' } | { status: 'forbidden' };

// Ejecuta `fn` bajo el bloqueo del modulo.
//   - ocupado       -> no ejecuta `fn` y NO libera nada (no es suyo).
//   - prohibido     -> quien llama no es de este modulo: no ejecuta `fn`.
//   - no disponible -> ejecuta `fn` sin bloqueo (y avisa).
//   - tomado        -> ejecuta `fn` y libera al terminar, incluso si `fn` lanza.
//   - sin modulo    -> ejecuta `fn` sin tocar la base.
export async function withGenerationLock<T>(
  supabase: any,
  moduleId: string | undefined,
  fn: () => Promise<T>
): Promise<LockOutcome<T>> {
  if (!moduleId || !supabase) return { status: 'ok', value: await fn() };

  const lock = await acquireGenerationLock(supabase, moduleId);
  if (lock === 'busy') return { status: 'busy' };
  if (lock === 'forbidden') return { status: 'forbidden' };
  if (lock === 'unavailable') {
    console.warn('[GENERATION_LOCK_UNAVAILABLE] se genera SIN bloqueo anti-stampede', { moduleId });
  }

  try {
    return { status: 'ok', value: await fn() };
  } finally {
    if (lock === 'acquired') await releaseGenerationLock(supabase, moduleId);
  }
}
