// Donde viven los archivos de medios de Tonito (clips y poster), sin atar el codigo a un proveedor.
//
// La app pide los archivos por una RUTA RELATIVA ("clips/celebracion.v1.mp4") y esta capa la convierte en URL con una base que se
// elige con la variable NEXT_PUBLIC_TONITO_MEDIA_BASE_URL. Sin ella, la base es local (/tonito, la carpeta public/ del repo). Con ella,
// puede ser un bucket publico de Supabase Storage o un bucket de Cloudflare R2: cambiar de proveedor es cambiar UNA variable.
// Ver docs/TONITO_MEDIOS_Y_ALMACENAMIENTO.md.
//
// Funciones puras (sin red ni DOM), para poder probarlas.

export const LOCAL_MEDIA_BASE = '/tonito';

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

// Next sustituye esta variable en la compilacion: cambiarla exige volver a desplegar.
export const MEDIA_BASE = resolveMediaBase(process.env.NEXT_PUBLIC_TONITO_MEDIA_BASE_URL);

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

// Juzga la respuesta HTTP de un archivo remoto (para `npm run media:check`). `headers` con nombres en minusculas.
export function judgeMediaResponse(kind: MediaKind, status: number, headers: Record<string, string | undefined>): MediaVerdict {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (status !== 200) {
    errors.push(`responde HTTP ${status}, se esperaba 200`);
    return { ok: false, errors, warnings };
  }
  const type = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (kind === 'video' && type !== 'video/mp4') errors.push(`tipo "${type || 'ninguno'}", se esperaba video/mp4`);
  if (kind === 'poster' && !/^image\/(jpeg|webp)$/.test(type)) errors.push(`tipo "${type || 'ninguno'}", se esperaba image/jpeg o image/webp`);

  const len = Number(headers['content-length']);
  if (!Number.isFinite(len) || len <= 0) warnings.push('no informa content-length');
  else if (len > MAX_BYTES[kind]) errors.push(`pesa ${(len / 1024).toFixed(0)} KB y el tope es ${MAX_BYTES[kind] / 1024} KB`);

  if (kind === 'video' && !/bytes/i.test(headers['accept-ranges'] ?? '')) warnings.push('no declara accept-ranges: bytes (algunos navegadores no podran avanzar ni reanudar el video)');

  const cc = headers['cache-control'] ?? '';
  const maxAge = Number(/(?:^|[ ,])max-age=(\d+)/i.exec(cc)?.[1]);
  if (!cc) warnings.push('sin cache-control: el CDN y el navegador decidiran solos');
  else if (/no-store|no-cache/i.test(cc)) errors.push(`cache-control "${cc}" impide cachear un archivo inmutable`);
  else if (!Number.isFinite(maxAge)) warnings.push(`cache-control "${cc}" sin max-age`);
  else if (maxAge < 86400) warnings.push(`max-age de ${maxAge} s es corto para un archivo inmutable (conviene 31536000)`);

  return { ok: errors.length === 0, errors, warnings };
}
