// Clips de video de Toñito para las cinematicas a pantalla completa (prueba de concepto; ver docs/TONITO_PRUEBA_DE_CONCEPTO.md).
//
// Decision de diseno, con numeros medidos: los clips NO llevan transparencia. Son para cinematicas a pantalla completa, asi que
// traen su PROPIO fondo (generado con el color de la escena) y se reproducen como un video H.264 normal, que funciona en todos los
// dispositivos. El personaje que acompana al estudiante dentro de la interfaz sigue siendo una pose fija con transparencia.
//
// Funciones puras (sin DOM), para poder probarlas. El navegador las alimenta con readClipEnvironment().

export interface TonitoClipDef {
  id: string;
  // Video H.264 en MP4, sin audio (el sonido lo pone el codigo con useSoundFx). Peso objetivo: <= 400 KB.
  src: string;
  // Imagen fija del clip: se ve mientras carga y si el video no se puede reproducir.
  poster: string;
  width: number;
  height: number;
  loop: boolean;
}

// Vacio a proposito: los archivos reales todavia no se han aprobado para publicarse. Con el registro vacio las cinematicas
// se comportan exactamente como antes. Cada entrada nueva necesita su MP4 y su poster en public/tonito/clips/.
export const TONITO_CLIPS: Record<string, TonitoClipDef> = {};

export type ClipPlanReason = 'ok' | 'reduced-motion' | 'save-data' | 'slow-network' | 'no-video-support';

export interface ClipPlan {
  mode: 'video' | 'still';
  reason: ClipPlanReason;
}

export interface ClipEnvironment {
  // El usuario pidio menos movimiento (prefers-reduced-motion).
  reducedMotion: boolean;
  // Modo de ahorro de datos del navegador (Save-Data), si lo expone.
  saveData?: boolean;
  // Tipo de conexion efectivo (navigator.connection.effectiveType), si lo expone.
  effectiveType?: string;
  // El navegador dice poder reproducir H.264 en MP4. undefined = no se pudo comprobar (se intenta igual).
  canPlayMp4?: boolean;
}

const SLOW = new Set(['slow-2g', '2g']);

// Cuando NO se carga el video: movimiento reducido, ahorro de datos, conexion muy lenta o sin soporte. En esos casos la cinematica
// usa lo de siempre (la pose fija con animacion CSS). El orden importa: el movimiento reducido manda sobre todo lo demas.
export function planClip(env: ClipEnvironment): ClipPlan {
  if (env.reducedMotion) return { mode: 'still', reason: 'reduced-motion' };
  if (env.saveData) return { mode: 'still', reason: 'save-data' };
  if (env.effectiveType && SLOW.has(env.effectiveType)) return { mode: 'still', reason: 'slow-network' };
  if (env.canPlayMp4 === false) return { mode: 'still', reason: 'no-video-support' };
  return { mode: 'video', reason: 'ok' };
}

// Decide que se muestra en una escena: el video solo si hay clip registrado, el plan lo permite y no fallo al cargar.
export function sceneUsesVideo(clip: TonitoClipDef | undefined, plan: ClipPlan | null, failed: boolean): boolean {
  return !!clip && !failed && plan?.mode === 'video';
}

// Lee el entorno del navegador. Solo se llama en el cliente (despues de montar): en el servidor no hay DOM.
export function readClipEnvironment(): ClipEnvironment {
  const nav: any = typeof navigator !== 'undefined' ? navigator : {};
  const conn = nav.connection;
  let canPlayMp4: boolean | undefined;
  try {
    const v = document.createElement('video');
    const r = v.canPlayType('video/mp4; codecs="avc1.42E01E"');
    canPlayMp4 = r === 'probably' || r === 'maybe';
  } catch {
    canPlayMp4 = undefined;
  }
  return {
    reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    saveData: !!conn?.saveData,
    effectiveType: typeof conn?.effectiveType === 'string' ? conn.effectiveType : undefined,
    canPlayMp4,
  };
}
