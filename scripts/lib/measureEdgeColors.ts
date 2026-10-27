// Mide los 6 colores de borde de un clip o imagen con ffmpeg (el mismo que usa clip:prepare). Los argumentos y la conversion a hex viven en
// src/lib/tonito/clipColors.ts (puras, con pruebas); aqui solo se ejecuta ffmpeg.

import { spawnSync } from 'child_process';
import { parseVideoInfo } from '../../src/lib/tonito/clipPipeline';
import { rgbToHex, sampleArgs, sampleSpecs, isEdgeColors } from '../../src/lib/tonito/clipColors';

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

// `input` puede ser un archivo local o una URL (ffmpeg la lee directo). Lanza un Error con la causa si algo falla.
export function measureEdgeColors(input: string, ffmpeg: string = ffmpegPath()): string[] {
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', input], { encoding: 'utf8' });
  if (probe.error) throw new Error(`no se pudo ejecutar ffmpeg (${ffmpeg}). Instalalo o pon su ruta en FFMPEG_PATH. Windows: winget install Gyan.FFmpeg`);
  // Una imagen no trae "Duration": parseVideoInfo exige las dos cosas, asi que para imagenes se lee solo el tamano.
  const size = parseVideoInfo(`${probe.stderr}`) ?? parseImageSize(`${probe.stderr}`);
  if (!size) throw new Error('ffmpeg no reconoce ese archivo como video ni como imagen');

  const colors = sampleSpecs().map(({ side, yFrac }) => {
    const r = spawnSync(ffmpeg, sampleArgs(input, size, side, yFrac), { encoding: 'buffer', maxBuffer: 1024 * 1024 });
    if (r.status !== 0 || !r.stdout || r.stdout.length < 3) throw new Error(`ffmpeg no pudo medir el borde ${side} (${yFrac})`);
    return rgbToHex(r.stdout);
  });
  if (!isEdgeColors(colors)) throw new Error('los colores medidos no son validos');
  return colors;
}

function parseImageSize(ffmpegStderr: string): { width: number; height: number } | null {
  const m = /Stream #\d+:\d+[^\n]*Video:[^\n]*?[ ,](\d{2,5})x(\d{2,5})[ ,\[]/.exec(ffmpegStderr);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}
