// Topes y validaciones de los medios importados (paso 4). Todo puro: se prueba sin red.
//
// Plan gratuito de Supabase: 1 GB de almacenamiento y 5 GB de salida al mes. Un video de 10 MB visto por 30
// estudiantes son 300 MB de salida: por eso los videos son cortos, no se reproducen solos y hay un tope por clase.

export type MediaKind = 'image' | 'video';

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const VIDEO_MIMES = ['video/mp4', 'video/webm'] as const;

export const MAX_IMAGE_BYTES = 1 * 1024 * 1024; // tras comprimir en el navegador
export const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
export const MAX_CLASS_MEDIA_BYTES = 100 * 1024 * 1024; // por clase
export const MAX_CLASS_MEDIA_COUNT = 60;
export const IMAGE_MAX_SIDE_PX = 1600;

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export interface Decision {
  ok: boolean;
  reason?: string;
}

export function kindOfMime(mime: string): MediaKind | null {
  if ((IMAGE_MIMES as readonly string[]).includes(mime)) return 'image';
  if ((VIDEO_MIMES as readonly string[]).includes(mime)) return 'video';
  return null;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export interface MediaInput {
  classroomId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  altText: string;
  caption?: string | null;
}

// Valida lo que manda el navegador antes de emitir una URL de subida.
export function validateMediaInput(input: MediaInput): Decision {
  if (!/^[0-9a-f-]{36}$/i.test(input.classroomId)) return { ok: false, reason: 'Clase invalida.' };
  if (!input.filename || input.filename.length > 200) return { ok: false, reason: 'Nombre de archivo invalido.' };
  const kind = kindOfMime(input.mimeType);
  if (!kind) return { ok: false, reason: 'Solo se aceptan imagenes PNG, JPG o WebP y videos MP4 o WebM.' };
  if (EXT_TO_MIME[extensionOf(input.filename)] !== input.mimeType) return { ok: false, reason: 'La extension del archivo no coincide con su tipo.' };
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, reason: 'Archivo vacio.' };
  const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (input.sizeBytes > max) {
    return { ok: false, reason: `${kind === 'image' ? 'La imagen' : 'El video'} excede ${Math.round(max / 1024 / 1024)} MB.` };
  }
  const alt = (input.altText ?? '').trim();
  if (alt.length < 3) return { ok: false, reason: 'Describe la imagen o video (texto alternativo): es lo que escuchan quienes no pueden verlo.' };
  if (alt.length > 300) return { ok: false, reason: 'La descripcion es demasiado larga (maximo 300 caracteres).' };
  if (input.caption && input.caption.length > 300) return { ok: false, reason: 'El pie de foto es demasiado largo (maximo 300 caracteres).' };
  return { ok: true };
}

// Cabe un archivo mas en la clase?
export function checkClassQuota(current: { count: number; bytes: number }, addBytes: number): Decision {
  if (current.count >= MAX_CLASS_MEDIA_COUNT) return { ok: false, reason: `La clase ya tiene ${MAX_CLASS_MEDIA_COUNT} archivos. Borra alguno para subir otro.` };
  if (current.bytes + addBytes > MAX_CLASS_MEDIA_BYTES) {
    const left = Math.max(0, MAX_CLASS_MEDIA_BYTES - current.bytes);
    return { ok: false, reason: `No cabe: quedan ${formatMB(left)} de ${formatMB(MAX_CLASS_MEDIA_BYTES)} en esta clase.` };
  }
  return { ok: true };
}

export function formatMB(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

// El tipo declarado por el navegador no es de fiar: se mira el contenido real (primeros bytes).
export function sniffMediaType(b: Uint8Array): string | null {
  const ascii = (from: number, s: string) => s.split('').every((c, i) => b[from + i] === c.charCodeAt(0));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (b.length >= 12 && ascii(4, 'ftyp')) return 'video/mp4';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return null;
}

// Ruta de almacenamiento: {classroom}/{timestamp}_{nombre-seguro}
export function mediaStoragePath(classroomId: string, filename: string, now: number = Date.now()): string {
  const ext = extensionOf(filename);
  const base = filename
    .slice(0, filename.length - (ext ? ext.length + 1 : 0))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'medio';
  return `${classroomId}/${now}_${base}.${ext}`;
}

// Escala (sin ampliar) para que el lado mayor no pase de max.
export function fitWithin(width: number, height: number, max: number = IMAGE_MAX_SIDE_PX): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > max)) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
