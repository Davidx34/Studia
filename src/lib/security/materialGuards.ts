// Topes y validaciones del procesamiento de materiales (revision de seguridad del 2026-10-10).
//
// Cada procesamiento de un material gasta cuota: embeddings de Gemini por fragmento y, en PDF con formulas o
// graficos, lectura con vision (Gemini y, de respaldo, OpenRouter de pago). Sin topes, un material enorme o un
// "reprocesar" repetido en bucle podia drenar esa cuota.

import { ALLOWED_MIME_TYPES, EXT_TO_MIME, MAX_FILE_SIZE_BYTES, TEXT_MIME_TYPES } from '@/lib/materials/constants';

export const MAX_PDF_PAGES = 300;
// ~600 fragmentos de ~500 tokens = ~300.000 tokens. Los materiales reales de Microeconomia tienen 2-16.
export const MAX_CHUNKS_PER_MATERIAL = 600;
// Un material no se vuelve a procesar antes de este tiempo, ni mientras otro procesamiento sigue en curso.
export const MIN_REPROCESS_INTERVAL_MS = 60_000;
export const PROCESSING_STALE_MS = 5 * 60_000;

export interface Decision {
  ok: boolean;
  reason?: string;
}

// Puro: decide si se puede empezar a procesar un material.
export function canStartProcessing(status: string | null | undefined, startedAt: string | null | undefined, now: number): Decision {
  if (!startedAt) return { ok: true };
  const age = now - new Date(startedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return { ok: true };
  if (status === 'processing' && age < PROCESSING_STALE_MS) {
    return { ok: false, reason: 'Este material ya se esta procesando. Espera a que termine.' };
  }
  if (age < MIN_REPROCESS_INTERVAL_MS) {
    const wait = Math.ceil((MIN_REPROCESS_INTERVAL_MS - age) / 1000);
    return { ok: false, reason: `Acabas de procesar este material. Intenta de nuevo en ${wait} s.` };
  }
  return { ok: true };
}

// Reclama el procesamiento con compare-and-set sobre processing_started_at: dos peticiones simultaneas no
// pueden ganar las dos.
export async function claimProcessing(supabase: any, materialId: string, now: number = Date.now()): Promise<Decision> {
  const { data: row, error } = await supabase
    .from('teaching_materials')
    .select('processing_status, processing_started_at')
    .eq('id', materialId)
    .single();
  if (error || !row) return { ok: false, reason: 'Material no encontrado o sin permisos.' };

  const decision = canStartProcessing(row.processing_status, row.processing_started_at, now);
  if (!decision.ok) return decision;

  let q = supabase.from('teaching_materials').update({ processing_started_at: new Date(now).toISOString() }).eq('id', materialId);
  q = row.processing_started_at ? q.eq('processing_started_at', row.processing_started_at) : q.is('processing_started_at', null);
  const { data: claimed, error: claimError } = await q.select('id');
  if (claimError || !claimed || claimed.length === 0) return { ok: false, reason: 'Este material ya se esta procesando.' };
  return { ok: true };
}

// ---------------------------------------------------------------- subida de archivos

export interface UploadInput {
  classroomId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

// Puro. Valida lo que manda el navegador: la ruta debe estar DENTRO de la carpeta de la clase (antes se
// guardaba tal cual, sin compararla con la ruta que el servidor emitio), el tipo debe ser uno permitido y
// coincidir con la extension, y el tamaño estar dentro del limite.
export function validateUploadInput(input: UploadInput): Decision {
  const { storagePath, filename, mimeType, sizeBytes, classroomId } = input;

  if (!/^[0-9a-f-]{36}$/i.test(classroomId)) return { ok: false, reason: 'Clase invalida.' };
  if (!storagePath.startsWith(`${classroomId}/`)) return { ok: false, reason: 'La ruta del archivo no corresponde a esta clase.' };
  const rest = storagePath.slice(classroomId.length + 1);
  if (!rest || rest.includes('/') || rest.includes('\\') || rest.includes('..') || rest.includes('\0') || rest.length > 250) {
    return { ok: false, reason: 'La ruta del archivo no es valida.' };
  }

  if (!filename || filename.length > 200) return { ok: false, reason: 'Nombre de archivo invalido.' };
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) return { ok: false, reason: `Tipo de archivo no permitido: ${mimeType}` };

  // El tipo declarado debe corresponder a la extension real (un .exe no puede declararse "application/pdf").
  const byExt = EXT_TO_MIME[extensionOf(filename)];
  const bothText = !!byExt && TEXT_MIME_TYPES.includes(byExt) && TEXT_MIME_TYPES.includes(mimeType);
  if (byExt !== mimeType && !bothText) return { ok: false, reason: 'La extension del archivo no coincide con su tipo.' };

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, reason: 'Archivo vacio.' };
  if (sizeBytes > MAX_FILE_SIZE_BYTES) return { ok: false, reason: 'Archivo excede 10 MB.' };
  return { ok: true };
}
