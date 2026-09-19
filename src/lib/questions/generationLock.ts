// Lock optimista para evitar cache stampede en generación de preguntas.
// Patrón: solo una generación por módulo puede estar en curso simultáneamente.
//
// Historia (2026-09-19): este bloqueo estuvo ROTO en produccion desde que se
// escribio, sin que nadie lo notara. La migracion 041 que agrega la columna
// is_generating estaba en el repositorio pero nunca se aplico, asi que el UPDATE
// fallaba siempre (PGRST204) y la funcion devolvia `false`. La ruta lo leia como
// "ya hay otra generacion en curso", respondia 202 sin preguntas, y ningun modulo
// con el cache vacio podia generarse al abrirlo. El fallo quedo enmascarado
// mientras la pagina del estudiante rellenaba con preguntas falsas; el PR #54
// retiro ese relleno y lo dejo a la vista.
//
// Lo que este modulo hace distinto para que no se repita:
//   - Distingue "ocupado" (otra generacion legitima en curso) de "no disponible"
//     (el bloqueo mismo esta roto). Un bloqueo roto NO debe impedir generar: se
//     avisa en el log y se sigue sin bloqueo. Peor es no generar nunca.
//   - El bloqueo CADUCA. Si una generacion muere sin liberarlo (timeout de la
//     funcion, caida del proceso), el modulo no queda bloqueado para siempre.
//   - Solo libera quien lo tomo. Antes el `finally` de la ruta lo liberaba
//     siempre, asi que una peticion que recibia "ocupado" liberaba el bloqueo de
//     la que si estaba generando y dejaba entrar a una tercera.

export type LockResult = 'acquired' | 'busy' | 'unavailable';

// Mas que el tiempo razonable de una generacion (unas decenas de segundos), pero
// corto para que un modulo abandonado se libere pronto.
export const LOCK_TTL_MS = 3 * 60 * 1000;

export async function acquireGenerationLock(supabase: any, moduleId: string, nowMs: number = Date.now()): Promise<LockResult> {
  const cutoff = new Date(nowMs - LOCK_TTL_MS).toISOString();

  // Se puede tomar si esta libre, o si el bloqueo es viejo/abandonado (o de antes
  // de que existiera la marca de tiempo).
  const { data, error } = await supabase
    .from('content_modules')
    .update({ is_generating: true, generation_started_at: new Date(nowMs).toISOString() })
    .eq('id', moduleId)
    .or(`is_generating.eq.false,generation_started_at.is.null,generation_started_at.lt.${cutoff}`)
    .select('id');

  if (error) {
    console.error('[GENERATION_LOCK_UNAVAILABLE]', { moduleId, code: error.code, message: error.message });
    return 'unavailable';
  }

  // Si no hay filas actualizadas, significa que ya hay generación en curso
  return (data?.length ?? 0) > 0 ? 'acquired' : 'busy';
}

export async function releaseGenerationLock(supabase: any, moduleId: string): Promise<void> {
  await supabase
    .from('content_modules')
    .update({ is_generating: false, generation_started_at: null })
    .eq('id', moduleId);
}

// Ejecuta `fn` bajo el bloqueo del modulo.
//   - ocupado      -> no ejecuta `fn` y NO libera nada (no es suyo).
//   - no disponible-> ejecuta `fn` sin bloqueo (y avisa).
//   - tomado       -> ejecuta `fn` y libera al terminar, incluso si `fn` lanza.
//   - sin modulo   -> ejecuta `fn` sin tocar la base.
export async function withGenerationLock<T>(
  supabase: any,
  moduleId: string | undefined,
  fn: () => Promise<T>
): Promise<{ busy: true } | { busy: false; value: T }> {
  if (!moduleId || !supabase) return { busy: false, value: await fn() };

  const lock = await acquireGenerationLock(supabase, moduleId);
  if (lock === 'busy') return { busy: true };
  if (lock === 'unavailable') {
    console.warn('[GENERATION_LOCK_UNAVAILABLE] se genera SIN bloqueo anti-stampede', { moduleId });
  }

  try {
    return { busy: false, value: await fn() };
  } finally {
    if (lock === 'acquired') await releaseGenerationLock(supabase, moduleId);
  }
}
