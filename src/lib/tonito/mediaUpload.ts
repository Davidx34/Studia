// Reglas para SUBIR un medio de Toñito al bucket publico (scripts/media-upload.ts). Funciones puras (sin red ni disco).
//
// Antes de subir se comprueba, para que un error cueste segundos y no un despliegue:
//   - el nombre: ruta relativa con VERSION (clips/celebracion.v1.mp4). Los archivos son inmutables y no se sobrescriben;
//   - el peso frente al tope de la ficha de arte (clip 400 KB, poster 60 KB);
//   - que el CONTENIDO sea de verdad lo que dice la extension (no un .mp4 que en realidad es otra cosa);
//   - en los MP4, que el indice (`moov`) vaya ANTES de los datos (`mdat`): es lo que hace `-movflags +faststart`. Sin eso el
//     navegador no puede empezar a reproducir hasta descargar el archivo entero.

import { MAX_BYTES, VERSIONED_POSTER, VERSIONED_VIDEO, type MediaKind } from './media';

export const TONITO_BUCKET = 'tonito-media';
// Un año, en segundos: los archivos son inmutables (version en el nombre), asi que pueden cachearse para siempre.
export const CACHE_CONTROL_SECONDS = '31536000';

export type SniffedMime = 'video/mp4' | 'image/jpeg' | 'image/webp';

const ascii = (b: Uint8Array, from: number, len: number): string => String.fromCharCode(...Array.from(b.subarray(from, from + len)));

// Reconoce el tipo por los primeros bytes (no por la extension).
export function sniffMime(b: Uint8Array): SniffedMime | null {
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') return 'video/mp4';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

// Tipos de las cajas de primer nivel de un MP4, en orden. Se detiene si una caja es invalida.
export function mp4TopLevelBoxes(b: Uint8Array): string[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: string[] = [];
  let off = 0;
  while (off + 8 <= b.length) {
    let size = view.getUint32(off);
    const type = ascii(b, off + 4, 4);
    if (size === 1) {
      if (off + 16 > b.length) break;
      size = Number(view.getBigUint64(off + 8)); // tamano de 64 bits
    } else if (size === 0) {
      out.push(type); // hasta el final del archivo
      break;
    }
    if (size < 8) break;
    out.push(type);
    off += size;
  }
  return out;
}

export interface UploadPlan {
  ok: boolean;
  kind?: MediaKind;
  contentType?: SniffedMime;
  errors: string[];
  warnings: string[];
}

const EXT_MIME: Record<string, SniffedMime> = { mp4: 'video/mp4', jpg: 'image/jpeg', webp: 'image/webp' };

export function planUpload(relPath: string, bytes: Uint8Array): UploadPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const kind: MediaKind | undefined = VERSIONED_VIDEO.test(relPath) ? 'video' : VERSIONED_POSTER.test(relPath) ? 'poster' : undefined;
  if (!kind) {
    errors.push(`el nombre "${relPath}" no sirve: debe ser clips/<nombre>.v<N>.mp4 (video) o clips/<nombre>.v<N>.jpg|webp (poster), en minusculas`);
    return { ok: false, errors, warnings };
  }

  if (bytes.length === 0) errors.push('el archivo esta vacio');
  else if (bytes.length > MAX_BYTES[kind]) errors.push(`pesa ${(bytes.length / 1024).toFixed(0)} KB y el tope de un ${kind === 'video' ? 'clip' : 'poster'} es ${MAX_BYTES[kind] / 1024} KB`);

  const ext = relPath.slice(relPath.lastIndexOf('.') + 1);
  const expected = EXT_MIME[ext];
  const real = sniffMime(bytes);
  if (!real) errors.push('el contenido no es un MP4, JPEG ni WebP');
  else if (real !== expected) errors.push(`la extension .${ext} dice ${expected} pero el contenido es ${real}`);

  if (real === 'video/mp4' && errors.length === 0) {
    const boxes = mp4TopLevelBoxes(bytes);
    const moov = boxes.indexOf('moov');
    const mdat = boxes.indexOf('mdat');
    if (moov === -1) errors.push('el MP4 no tiene indice (moov): esta incompleto o danado');
    else if (mdat !== -1 && moov > mdat) warnings.push('el MP4 no tiene faststart (moov va despues de mdat): no empezara a reproducirse hasta descargarse entero. Recodifica con -movflags +faststart');
  }

  return { ok: errors.length === 0, kind, contentType: real ?? undefined, errors, warnings };
}

// URL base publica de un bucket publico de Supabase Storage: es el valor de NEXT_PUBLIC_TONITO_MEDIA_BASE_URL.
export function supabasePublicBase(supabaseUrl: string, bucket: string = TONITO_BUCKET): string {
  return `${supabaseUrl.trim().replace(/\/+$/, '')}/storage/v1/object/public/${bucket}`;
}
