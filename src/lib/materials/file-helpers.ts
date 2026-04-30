// Helpers de archivos para materials
// Fase 11.C · Stud.ia

import { ALLOWED_MIME_TYPES, EXT_TO_MIME, MAX_FILE_SIZE_BYTES } from './constants';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  return filename.slice(idx + 1).toLowerCase();
}

/**
 * Detecta MIME basado en (orden de preferencia):
 *   1. file.type (si el browser lo proveyó)
 *   2. extensión del filename
 * Devuelve null si no se puede determinar.
 */
export function detectMimeType(file: File): string | null {
  if (file.type && (ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return file.type;
  }
  const ext = getExtension(file.name);
  return EXT_TO_MIME[ext] ?? null;
}

export interface FileValidationError {
  code: 'invalid_mime' | 'too_large' | 'empty';
  message: string;
}

export function validateFile(file: File): FileValidationError | null {
  if (file.size === 0) {
    return { code: 'empty', message: 'El archivo está vacío.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      code: 'too_large',
      message: `El archivo excede el tamaño máximo (10 MB). Tiene ${formatBytes(file.size)}.`,
    };
  }
  const mime = detectMimeType(file);
  if (!mime) {
    return {
      code: 'invalid_mime',
      message: 'Tipo de archivo no soportado. Sube PDF, DOCX o XLSX.',
    };
  }
  return null;
}

/**
 * Calcula SHA-256 del File usando Web Crypto API.
 * Retorna hex string (64 chars).
 */
export async function computeFileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Slugifica filename para storage path (saca chars que pueden romper paths).
 */
export function slugifyFilename(filename: string): string {
  return filename
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sacar tildes
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
}
