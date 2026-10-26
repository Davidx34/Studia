// Reglas para PREPARAR un clip nuevo a partir de un video en bruto (scripts/clip-prepare.ts). Funciones puras (sin disco ni ffmpeg).
//
// El flujo completo esta en docs/TONITO_CINEMATICAS.md. Aqui solo viven las decisiones que conviene probar: el nombre y la version, los
// argumentos de ffmpeg, la escalera de calidad para entrar en el peso maximo y el texto que hay que pegar en el registro.

import { MAX_BYTES } from './media';

export const CLIP_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const validClipId = (id: string): boolean => CLIP_ID.test(id);

// Siguiente version libre de un clip: mira el registro (rutas relativas ya usadas) y devuelve N+1 (1 si no existe).
export function nextVersion(id: string, usedPaths: string[]): number {
  const re = new RegExp(`^clips/${id}\\.v(\\d+)\\.(mp4|jpg|webp)$`);
  let max = 0;
  for (const p of usedPaths) {
    const m = re.exec(p);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export const clipPaths = (id: string, version: number) => ({
  video: `clips/${id}.v${version}.mp4`,
  poster: `clips/${id}.v${version}.jpg`,
});

// Escalera de calidad: se prueba de mejor a peor y se queda la primera que entra en el peso maximo del video. Si ninguna entra, el
// script avisa en lugar de subir algo fuera de la ficha de arte.
export interface EncodeStep {
  maxWidth: number;
  crf: number;
}
export const ENCODE_LADDER: EncodeStep[] = [
  { maxWidth: 720, crf: 28 },
  { maxWidth: 720, crf: 31 },
  { maxWidth: 720, crf: 34 },
  { maxWidth: 540, crf: 31 },
  { maxWidth: 540, crf: 35 },
  { maxWidth: 480, crf: 38 },
];

// H.264 main, yuv420p, sin audio y con el indice al principio (faststart): lo que reproducen todos los dispositivos y lo que exige
// planUpload. `-2` mantiene la proporcion con alto par (H.264 lo exige).
export function videoArgs(input: string, output: string, step: EncodeStep): string[] {
  return [
    '-y', '-i', input,
    '-vf', `scale='min(${step.maxWidth},iw)':-2`,
    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(step.crf),
    '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    output,
  ];
}

// Un cuadro del video ya convertido como poster (JPEG). `quality` de ffmpeg: 2 = mejor, 31 = peor.
export function posterArgs(video: string, output: string, atSeconds: number, quality: number): string[] {
  return ['-y', '-ss', String(atSeconds), '-i', video, '-frames:v', '1', '-q:v', String(quality), output];
}

export const POSTER_QUALITIES = [4, 6, 9, 13, 18];

export const fitsVideo = (bytes: number): boolean => bytes > 0 && bytes <= MAX_BYTES.video;
export const fitsPoster = (bytes: number): boolean => bytes > 0 && bytes <= MAX_BYTES.poster;

export interface VideoInfo {
  width: number;
  height: number;
  seconds: number;
}

// Lee ancho, alto y duracion de lo que imprime `ffmpeg -i archivo` (por stderr).
export function parseVideoInfo(ffmpegStderr: string): VideoInfo | null {
  const dim = /Stream #\d+:\d+[^\n]*Video:[^\n]*?[ ,](\d{2,5})x(\d{2,5})[ ,\[]/.exec(ffmpegStderr);
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(ffmpegStderr);
  if (!dim || !dur) return null;
  return { width: Number(dim[1]), height: Number(dim[2]), seconds: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) };
}

// Duracion razonable para una cinematica (la ficha de arte pide clips cortos). Fuera de rango no es error, es un aviso.
export function durationWarning(seconds: number): string | null {
  if (seconds > 8) return `dura ${seconds.toFixed(1)} s: una cinematica corta (2 a 6 s) pesa menos y no hace esperar al estudiante`;
  if (seconds < 1) return `dura ${seconds.toFixed(1)} s: es muy corto para verse`;
  return null;
}

// Lineas para pegar en el codigo una vez subidos los archivos.
export function registrySnippet(opts: { id: string; version: number; width: number; height: number; loop: boolean; scene?: string }): string {
  const { video, poster } = clipPaths(opts.id, opts.version);
  const entry = `  ${/^[a-z]+$/.test(opts.id) ? opts.id : `'${opts.id}'`}: { id: '${opts.id}', src: '${video}', poster: '${poster}', width: ${opts.width}, height: ${opts.height}, loop: ${opts.loop} },`;
  const scene = opts.scene ? `\n\nEn src/components/cinematics/CinematicScene.tsx, dentro de SCENES.${opts.scene}, anade:\n  clipId: '${opts.id}',` : '';
  return `En src/lib/tonito/clips.ts, dentro de TONITO_CLIPS, anade:\n${entry}${scene}`;
}
