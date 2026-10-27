// COLORES DE LOS BORDES de un clip, para que la escena pinte detras del clip exactamente lo que el clip trae en sus bordes.
//
// Problema (medido): el clip de celebracion es vertical; en un computador se muestra entero y centrado, y su fondo es mas palido que el degradado de la escena (arriba
// #EEBC73 frente al #D97706 pedido). Se veia como una columna distinta de los lados. Flow no clava el color que se le pide, asi que en vez de pedirlo mejor se MIDE:
// al publicar el clip se toman 3 colores del borde izquierdo y 3 del derecho (arriba, medio, abajo) y la escena los usa de fondo.
//
// Funciones puras (sin ffmpeg ni disco): scripts/clip-colors.ts y clip-prepare.ts ejecutan ffmpeg con estos argumentos y le pasan los bytes de vuelta.

export const EDGE_SAMPLES = 6; // 3 a la izquierda (arriba, medio, abajo) + 3 a la derecha
const HEX = /^#[0-9a-f]{6}$/;

// Alturas (como fraccion del cuadro) donde se mide cada borde: lejos de Toñito, que va centrado.
export const SAMPLE_Y = [0.05, 0.5, 0.95] as const;
const PATCH = 4; // se promedia un cuadrito de 4x4 px

export interface Size {
  width: number;
  height: number;
}

export type Side = 'left' | 'right';

// Argumentos de ffmpeg para sacar el color promedio de un cuadrito del borde del PRIMER cuadro. Salida: 3 bytes RGB por stdout (rawvideo rgb24).
export function sampleArgs(input: string, size: Size, side: Side, yFrac: number): string[] {
  const x = side === 'left' ? 0 : Math.max(0, size.width - PATCH);
  const y = Math.max(0, Math.min(size.height - PATCH, Math.round(yFrac * (size.height - PATCH))));
  return ['-v', 'error', '-i', input, '-vf', `crop=${PATCH}:${PATCH}:${x}:${y},scale=1:1:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
}

// Las 6 muestras en el orden en que se guardan: izquierda arriba/medio/abajo, derecha arriba/medio/abajo.
export function sampleSpecs(): { side: Side; yFrac: number }[] {
  return [...SAMPLE_Y.map((y) => ({ side: 'left' as const, yFrac: y })), ...SAMPLE_Y.map((y) => ({ side: 'right' as const, yFrac: y }))];
}

export function rgbToHex(rgb: Uint8Array | number[]): string {
  if (rgb.length < 3) throw new Error('hacen falta 3 bytes (R, G, B)');
  return '#' + [rgb[0], rgb[1], rgb[2]].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export const isEdgeColors = (v: unknown): v is string[] => Array.isArray(v) && v.length === EDGE_SAMPLES && v.every((c) => typeof c === 'string' && HEX.test(c));

// Fondo CSS de cada lado: un degradado vertical con las 3 muestras de ese borde. Si los colores no son validos, null (la escena usa su degradado de siempre).
export function edgeBackgrounds(colors: unknown): { left: string; right: string } | null {
  if (!isEdgeColors(colors)) return null;
  return {
    left: `linear-gradient(to bottom, ${colors[0]}, ${colors[1]}, ${colors[2]})`,
    right: `linear-gradient(to bottom, ${colors[3]}, ${colors[4]}, ${colors[5]})`,
  };
}

// Luminancia relativa (WCAG) y contraste del texto blanco sobre un color: para avisar si un fondo es demasiado claro para el texto de la escena.
export function luminance(hex: string): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
export const whiteTextContrast = (hex: string): number => 1.05 / (luminance(hex) + 0.05);
