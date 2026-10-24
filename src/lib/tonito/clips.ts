// Clips de video de Toñito para las cinematicas a pantalla completa (prueba de concepto; ver docs/TONITO_PRUEBA_DE_CONCEPTO.md).
//
// Decision de diseno, con numeros medidos: los clips NO llevan transparencia. Son para cinematicas a pantalla completa, asi que
// traen su PROPIO fondo (generado con el color de la escena) y se reproducen como un video H.264 normal, que funciona en todos los
// dispositivos. El personaje que acompana al estudiante dentro de la interfaz sigue siendo una pose fija con transparencia.
//
// Funciones puras (sin DOM), para poder probarlas. El navegador las alimenta con readClipEnvironment().

import { isExternalMediaBase } from './media';

export interface TonitoClipDef {
  id: string;
  // RUTAS RELATIVAS y con version en el nombre ("clips/celebracion.v1.mp4"); la URL final la arma mediaUrl() segun el proveedor
  // (carpeta public/, Supabase Storage o Cloudflare R2). Los archivos son inmutables: un cambio es una version nueva (.v2).
  // Video H.264 en MP4, sin audio (el sonido lo pone el codigo con useSoundFx). Peso objetivo: <= 400 KB.
  src: string;
  // Imagen fija del clip: se ve mientras carga y si el video no se puede reproducir. Peso objetivo: <= 60 KB.
  poster: string;
  width: number;
  height: number;
  loop: boolean;
}

// Donde viven los archivos de los clips: 'remote' = bucket publico de Supabase Storage `tonito-media` (se sirve desde la base que
// pone NEXT_PUBLIC_TONITO_MEDIA_BASE_URL); 'local' = carpeta public/tonito del repo. Cada entrada nueva necesita su MP4 y su poster
// subidos ahi (npm run media:upload) y comprobados (npm run media:check). Ver docs/TONITO_MEDIOS_Y_ALMACENAMIENTO.md.
export const CLIPS_HOSTING: 'remote' | 'local' = 'remote';

// Un clip alojado en remoto solo se pide si la base remota esta configurada: sin NEXT_PUBLIC_TONITO_MEDIA_BASE_URL (desarrollo, una vista
// previa sin la variable) la URL caeria a /tonito/ y daria 404. En ese caso la cinematica usa la pose de siempre, sin peticiones fallidas.
export function clipAvailable(clip: TonitoClipDef | undefined, externalBase: boolean = isExternalMediaBase()): boolean {
  if (!clip) return false;
  return CLIPS_HOSTING === 'local' || externalBase;
}

export const TONITO_CLIPS: Record<string, TonitoClipDef> = {
  // Celebracion de modulo completado (escena module_complete_good). Vertical 9:16, 4 s, H.264 sin audio, 303 KB + poster de 44 KB.
  celebracion: { id: 'celebracion', src: 'clips/celebracion.v1.mp4', poster: 'clips/celebracion.v1.jpg', width: 720, height: 1280, loop: false },
};

export type ClipPlanReason = 'ok' | 'reduced-motion' | 'save-data' | 'slow-network' | 'no-video-support' | 'orientation';

// Con object-cover, un video se recorta para llenar la pantalla. Si la pantalla se parece poco a la proporcion del clip, se ve solo una
// franja (medido con un clip 9:16: en una pantalla horizontal 16:9 se ve el ~32 % de la altura, torso y punos sin cabeza). Se exige
// que se vea al menos esta fraccion del clip.
export const MIN_VISIBLE_FRACTION = 0.7;

export interface Size {
  width: number;
  height: number;
}

// Fraccion del clip que SE VE con object-cover en una pantalla: si la pantalla es mas estrecha que el clip se pierde ancho; si es mas
// ancha, se pierde alto. 1 = se ve entero (misma proporcion).
export function visibleFraction(clip: Size, viewport: Size): number {
  if (!(clip.width > 0 && clip.height > 0 && viewport.width > 0 && viewport.height > 0)) return 1;
  const clipAspect = clip.width / clip.height;
  const viewAspect = viewport.width / viewport.height;
  return viewAspect <= clipAspect ? viewAspect / clipAspect : clipAspect / viewAspect;
}

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
  // Tamano de la ventana, para saber si la pantalla se parece a la proporcion del clip.
  viewport?: Size;
}

const SLOW = new Set(['slow-2g', '2g']);

// Cuando NO se carga el video: movimiento reducido, ahorro de datos, conexion muy lenta o sin soporte. En esos casos la cinematica
// usa lo de siempre (la pose fija con animacion CSS). El orden importa: el movimiento reducido manda sobre todo lo demas.
export function planClip(env: ClipEnvironment, clip?: Size): ClipPlan {
  if (env.reducedMotion) return { mode: 'still', reason: 'reduced-motion' };
  if (env.saveData) return { mode: 'still', reason: 'save-data' };
  if (env.effectiveType && SLOW.has(env.effectiveType)) return { mode: 'still', reason: 'slow-network' };
  if (env.canPlayMp4 === false) return { mode: 'still', reason: 'no-video-support' };
  // Pantalla con otra proporcion (p. ej. un clip vertical en un computador): se veria una franja y no a Tonito. Se usa lo de siempre.
  if (clip && env.viewport && visibleFraction(clip, env.viewport) < MIN_VISIBLE_FRACTION) return { mode: 'still', reason: 'orientation' };
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
    viewport: typeof window !== 'undefined' && window.innerWidth > 0 ? { width: window.innerWidth, height: window.innerHeight } : undefined,
  };
}
