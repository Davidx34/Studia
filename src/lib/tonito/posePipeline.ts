// Pasos puros (sin disco ni ffmpeg) para convertir una pose de Flow (imagen cuadrada de Toñito sobre fondo magenta #FF00FF) en el PNG transparente que usa la app.
// El script scripts/pose-prepare.ts los une con ffmpeg. Ver docs/TONITO_CATALOGO_ANIMACIONES.md (poses).

import { POSES } from './flowPrompts';
import { POSE_DIR, POSE_EXT } from './poseCrop';

// Cada pose del catalogo (P1-P8) es el PNG de un estado de TonitoCharacter: public/tonito/<estado>.png.
export const POSE_MOOD: Readonly<Record<string, string>> = {
  P1: 'happy',
  P2: 'excited',
  P3: 'encouraging',
  P4: 'thinking',
  P5: 'sad',
  P6: 'surprised',
  P7: 'celebrating',
  P8: 'sleeping',
};

export const POSE_CANVAS = 512;

export function moodForPose(idOrMood: string): string | null {
  const k = idOrMood.trim();
  const byId = POSE_MOOD[k.toUpperCase()];
  if (byId) return byId;
  return Object.values(POSE_MOOD).includes(k.toLowerCase()) ? k.toLowerCase() : null;
}

// Quita el reflejo magenta que el fondo deja en los bordes. Magenta = mucho rojo y azul, poco verde: lo que sobra del menor de R y B por encima de G se resta de ambos.
// El durazno (azul bajo), el cafe, el blanco y el beige no se tocan porque en ellos min(R, B) <= G. Modifica el arreglo en sitio y devuelve cuantos pixeles cambio.
export function despillMagenta(rgba: Uint8Array | Uint8ClampedArray): number {
  let changed = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const spill = Math.min(r, b) - g;
    if (spill > 0) {
      rgba[i] = r - spill;
      rgba[i + 2] = b - spill;
      changed++;
    }
  }
  return changed;
}

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

// Caja que contiene los pixeles con alfa > umbral (x1, y1 incluidos). null si no hay ninguno (por ejemplo, el fondo no se quito).
export function alphaBounds(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, threshold = 24): Bounds | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// Fraccion del cuadro que ocupa el personaje y en que punto caen los pies (todo en %).
export interface PoseStats { heightPct: number; feetPct: number; centroPct: number; opaquePct: number }

export function poseStats(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): PoseStats | null {
  const b = alphaBounds(rgba, w, h);
  if (!b) return null;
  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 24) opaque++;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    heightPct: r1(((b.y1 - b.y0 + 1) / h) * 100),
    feetPct: r1(((b.y1 + 1) / h) * 100),
    centroPct: r1((((b.x0 + b.x1 + 1) / 2) / w) * 100),
    opaquePct: r1((opaque / (w * h)) * 100),
  };
}

// Revisa una sola pose: avisos de lo que haria que se vea mal en la app.
export function poseWarnings(s: PoseStats | null): string[] {
  if (!s) return ['no quedo ningun pixel opaco: el fondo magenta no se detecto o la imagen es otra'];
  const out: string[] = [];
  if (s.opaquePct > 70) out.push(`el personaje ocupa ${s.opaquePct}% del cuadro: parte del fondo no se quito (¿no es magenta #FF00FF liso?)`);
  if (s.opaquePct < 8) out.push(`el personaje ocupa solo ${s.opaquePct}% del cuadro: se quito de mas o la imagen no es la esperada`);
  if (s.centroPct < 40 || s.centroPct > 60) out.push(`el personaje esta descentrado (centro en ${s.centroPct}% del ancho)`);
  if (s.feetPct > 99.5) out.push('los pies tocan el borde inferior: el cuerpo puede estar cortado');
  return out;
}

// Compara varias poses entre si. Si los pies o el tamaño cambian de una a otra, al cambiar de emocion en la app Toñito "salta".
export function consistencyWarnings(all: Record<string, PoseStats>): string[] {
  const entries = Object.entries(all);
  if (entries.length < 2) return [];
  const feet = median(entries.map(([, s]) => s.feetPct));
  const height = median(entries.map(([, s]) => s.heightPct));
  const out: string[] = [];
  for (const [id, s] of entries) {
    if (Math.abs(s.feetPct - feet) > 3) out.push(`${id}: los pies caen en ${s.feetPct}% y la mayoria en ${feet}% (la pose "salta" al cambiar)`);
    // Un salto o brazos en alto agrandan la caja sin que Toñito sea mas grande: el aviso de altura es solo orientativo.
    if (Math.abs(s.heightPct - height) > 12) out.push(`${id}: ocupa ${s.heightPct}% de la altura y la mayoria ${height}% (¿distinto tamaño de Toñito?)`);
  }
  return out;
}

export const POSE_IDS: readonly string[] = POSES.map((p) => p.id);

// Carpeta de la app donde van las poses (ruta bajo public/). Es una carpeta NUEVA, distinta de la de los PNG viejos (public/tonito/*.png): el service worker
// guarda las imagenes por nombre de archivo, y con el mismo nombre algunos estudiantes seguirian viendo la cabeza vieja hasta una semana.
export const POSE_PUBLIC_DIR = POSE_DIR.slice(1); // sin la barra inicial: 'tonito/poses'

// Cuantos pixeles hay que bajar (positivo) o subir (negativo) una pose para que sus pies caigan en la linea comun. null si la diferencia es mayor que maxPct:
// ahi no es un desajuste pequeño de Flow sino otra pose (un salto, por ejemplo), y moverla la dejaria mal.
export function feetShiftPx(feetPct: number, targetPct: number, size: number, maxPct = 8): number | null {
  const diff = targetPct - feetPct;
  if (Math.abs(diff) > maxPct) return null;
  return Math.round((diff / 100) * size);
}

// Copia la imagen desplazada dy filas (positivo = hacia abajo). Lo que queda libre es transparente y lo que sale del cuadro se pierde.
export function shiftRows(rgba: Uint8Array, w: number, h: number, dy: number): Uint8Array {
  const out = new Uint8Array(rgba.length);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    out.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), ny * rowBytes);
  }
  return out;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Formato de salida: WebP con transparencia, ~27 KB por pose frente a ~325 KB en PNG (8 poses = 2,5 MB en PNG, demasiado para avatares de 42 px en celular).
export { POSE_EXT };
