// Donde viven los archivos de medios de Tonito (clips y poster), sin atar el codigo a un proveedor.
//
// La app pide los archivos por una RUTA RELATIVA ("clips/celebracion.v1.mp4") y esta capa la convierte en URL con una base. Por
// defecto es el bucket publico `tonito-media` del MISMO proyecto de Supabase de la app (se deduce de NEXT_PUBLIC_SUPABASE_URL). Se
// puede cambiar con NEXT_PUBLIC_TONITO_MEDIA_BASE_URL: otro bucket (Supabase o Cloudflare R2) o la palabra `local` (carpeta
// public/tonito del repo). Cambiar de proveedor es cambiar UNA variable.
// Ver docs/TONITO_MEDIOS_Y_ALMACENAMIENTO.md.
//
// Funciones puras (sin red ni DOM), para poder probarlas.

export const LOCAL_MEDIA_BASE = '/tonito';
export const TONITO_BUCKET = 'tonito-media';

// Ruta relativa permitida: letras, numeros, punto, guion, guion bajo y barras; sin empezar por barra y sin "..".
const REL_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// Una base externa solo vale si es https, sin credenciales, parametros ni fragmento. Cualquier otra cosa cae a la base local: una
// variable mal escrita nunca debe dejar a las cinematicas sin sus archivos ni abrir la puerta a un origen inesperado.
export function resolveMediaBase(raw: string | undefined | null): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '');
  if (!v) return LOCAL_MEDIA_BASE;
  try {
    const u = new URL(v);
    if (u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash) return v;
  } catch {
    // base invalida: se usa la local
  }
  return LOCAL_MEDIA_BASE;
}

// Base por defecto: el bucket publico `tonito-media` del proyecto de Supabase de la app (no hay que configurar nada). Solo vale con
// https: un Supabase local en http no tiene el bucket en esta URL y se usa la carpeta local.
export function defaultMediaBase(supabaseUrl: string | undefined | null): string {
  const v = (supabaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!v) return LOCAL_MEDIA_BASE;
  try {
    const u = new URL(v);
    if (u.protocol === 'https:' && !u.username && !u.password) return `${u.origin}/storage/v1/object/public/${TONITO_BUCKET}`;
  } catch {
    // URL invalida: se usa la local
  }
  return LOCAL_MEDIA_BASE;
}

// Variable vacia o ausente -> el bucket del proyecto. Con valor -> ese valor si es valido; si no (por ejemplo la palabra `local`), la
// carpeta local.
export function pickMediaBase(raw: string | undefined | null, supabaseUrl: string | undefined | null): string {
  return (raw ?? '').trim() === '' ? defaultMediaBase(supabaseUrl) : resolveMediaBase(raw);
}

// Next sustituye estas variables en la compilacion: cambiarlas exige volver a desplegar.
export const MEDIA_BASE = pickMediaBase(process.env.NEXT_PUBLIC_TONITO_MEDIA_BASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL);

export const isExternalMediaBase = (base: string = MEDIA_BASE): boolean => base !== LOCAL_MEDIA_BASE;

export function mediaUrl(relPath: string, base: string = MEDIA_BASE): string {
  if (!REL_PATH.test(relPath) || relPath.includes('..') || relPath.includes('//')) {
    throw new Error(`Ruta de medio no valida: "${relPath}"`);
  }
  return `${base}/${relPath}`;
}

// Los archivos de medios son INMUTABLES: llevan la version en el nombre (celebracion.v2.mp4) y nunca se sobrescriben. Asi la cache
// larga del CDN y la del service worker (imagenes: 7 dias) no pueden servir una version vieja.
export const VERSIONED_VIDEO = /^clips\/[a-z0-9-]+\.v\d+\.mp4$/;
export const VERSIONED_POSTER = /^clips\/[a-z0-9-]+\.v\d+\.(jpg|webp)$/;

export type MediaKind = 'video' | 'poster';

export const MAX_BYTES: Record<MediaKind, number> = { video: 400 * 1024, poster: 60 * 1024 };

export interface MediaVerdict {
  ok: boolean;
  // Problemas que hay que corregir (el archivo no sirve tal cual).
  errors: string[];
  // Avisos (funciona, pero no es lo ideal).
  warnings: string[];
}

// Juzga la respuesta de UNA PETICION GET con Range: bytes=0-1 a un archivo remoto (para `npm run media:check`). `headers` con nombres
// en minusculas. Se usa GET y no HEAD: un HEAD no pasa por la cache del CDN y devuelve "private, no-cache" aunque el archivo se sirva
// con "public, max-age=31536000" por GET (medido con Supabase Storage).
export function judgeMediaResponse(kind: MediaKind, status: number, headers: Record<string, string | undefined>): MediaVerdict {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (status !== 200 && status !== 206) {
    errors.push(`responde HTTP ${status}, se esperaba 200 o 206`);
    return { ok: false, errors, warnings };
  }
  const type = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (kind === 'video' && type !== 'video/mp4') errors.push(`tipo "${type || 'ninguno'}", se esperaba video/mp4`);
  if (kind === 'poster' && !/^image\/(jpeg|webp)$/.test(type)) errors.push(`tipo "${type || 'ninguno'}", se esperaba image/jpeg o image/webp`);

  // Peso TOTAL: en una respuesta 206 sale de content-range ("bytes 0-1/219071"; content-length solo mide los 2 bytes pedidos).
  const total = status === 206 ? Number(/\/(\d+)\s*$/.exec(headers['content-range'] ?? '')?.[1]) : Number(headers['content-length']);
  if (!Number.isFinite(total) || total <= 0) warnings.push('no informa el tamano total');
  else if (total > MAX_BYTES[kind]) errors.push(`pesa ${(total / 1024).toFixed(0)} KB y el tope es ${MAX_BYTES[kind] / 1024} KB`);

  // Rangos: la peticion pidio solo 2 bytes; un 206 prueba que el servidor los admite (necesario para que el video avance y se reanude).
  if (kind === 'video' && status === 200) warnings.push('el servidor ignoro la peticion con Range y respondio el archivo completo: el video no podra avanzar ni reanudarse');

  const cc = headers['cache-control'] ?? '';
  const maxAge = Number(/(?:^|[ ,])max-age=(\d+)/i.exec(cc)?.[1]);
  if (!cc) warnings.push('sin cache-control: el CDN y el navegador decidiran solos');
  else if (/no-store|no-cache/i.test(cc)) errors.push(`cache-control "${cc}" impide cachear un archivo inmutable`);
  else if (!Number.isFinite(maxAge)) warnings.push(`cache-control "${cc}" sin max-age`);
  else if (maxAge < 86400) warnings.push(`max-age de ${maxAge} s es corto para un archivo inmutable (conviene 31536000)`);

  return { ok: errors.length === 0, errors, warnings };
}
