'use server';

// Medios importados a una clase (paso 4): imagenes y videos que el profesor genero afuera (Flow, Gemini, etc.).
//
// Seguridad (misma linea que los materiales):
//   - Cada accion exige sesion Y que la clase sea del profesor (ademas del RLS).
//   - La ruta de Storage la emite el servidor; al confirmar se verifica que este dentro de la carpeta de la clase,
//     que el archivo exista y su tamaño REAL (no el declarado), y que el CONTENIDO coincida con el tipo (bytes
//     iniciales): un ejecutable renombrado a .png se rechaza y se borra.
//   - Tope por clase (cantidad y MB) por el plan gratuito de Supabase.

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  checkClassQuota,
  kindOfMime,
  mediaStoragePath,
  sniffMediaType,
  validateMediaInput,
  type MediaInput,
} from '@/lib/media/mediaGuards';

const BUCKET = 'class-media';
const SIGNED_TTL_SECONDS = 60 * 5;

async function requireTeacherOfClass(classroomId: string) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', classroomId).eq('teacher_id', user.id).maybeSingle();
  return classroom ? { supabase, user } : null;
}

async function classUsage(supabase: any, classroomId: string): Promise<{ count: number; bytes: number }> {
  const { data } = await supabase.from('class_media').select('size_bytes').eq('classroom_id', classroomId);
  const rows = (data ?? []) as { size_bytes: number }[];
  return { count: rows.length, bytes: rows.reduce((n, r) => n + (r.size_bytes ?? 0), 0) };
}

export interface MediaUploadUrlResult {
  ok: boolean;
  storagePath?: string;
  token?: string;
  error?: string;
}

export async function getMediaUploadUrl(input: MediaInput): Promise<MediaUploadUrlResult> {
  const valid = validateMediaInput(input);
  if (!valid.ok) return { ok: false, error: valid.reason };
  const ctx = await requireTeacherOfClass(input.classroomId);
  if (!ctx) return { ok: false, error: 'Clase no encontrada o sin permisos.' };

  const quota = checkClassQuota(await classUsage(ctx.supabase, input.classroomId), input.sizeBytes);
  if (!quota.ok) return { ok: false, error: quota.reason };

  const storagePath = mediaStoragePath(input.classroomId, input.filename);
  const { data, error } = await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return { ok: false, error: error?.message ?? 'No se pudo preparar la subida.' };
  return { ok: true, storagePath, token: data.token };
}

export interface ConfirmMediaInput extends MediaInput {
  storagePath: string;
  moduleId?: string | null;
}

export async function confirmMediaUpload(input: ConfirmMediaInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const valid = validateMediaInput(input);
  if (!valid.ok) return { ok: false, error: valid.reason };
  const ctx = await requireTeacherOfClass(input.classroomId);
  if (!ctx) return { ok: false, error: 'Clase no encontrada o sin permisos.' };
  const { supabase, user } = ctx;

  const discard = async () => {
    await supabase.storage.from(BUCKET).remove([input.storagePath]);
  };

  // La ruta debe estar dentro de la carpeta de ESTA clase y ser un archivo directo.
  const prefix = `${input.classroomId}/`;
  const rest = input.storagePath.startsWith(prefix) ? input.storagePath.slice(prefix.length) : '';
  if (!rest || rest.includes('/') || rest.includes('\\') || rest.includes('..') || rest.length > 250) {
    return { ok: false, error: 'La ruta del archivo no corresponde a esta clase.' };
  }

  // Tamaño real desde Storage.
  const { data: listed } = await supabase.storage.from(BUCKET).list(input.classroomId, { search: rest, limit: 5 });
  const stored = (listed ?? []).find((f: any) => f.name === rest);
  if (!stored) return { ok: false, error: 'No encontramos el archivo subido. Intenta de nuevo.' };
  const realSize = Number((stored as any).metadata?.size ?? 0);
  const recheck = validateMediaInput({ ...input, sizeBytes: realSize });
  if (!recheck.ok) {
    await discard();
    return { ok: false, error: recheck.reason };
  }

  // Contenido real: primeros bytes por URL firmada de lectura (Range), comparados con el tipo declarado.
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(input.storagePath, SIGNED_TTL_SECONDS);
  let sniffed: string | null = null;
  if (signed?.signedUrl) {
    try {
      const res = await fetch(signed.signedUrl, { headers: { Range: 'bytes=0-31' }, signal: AbortSignal.timeout(15_000) });
      if (res.ok || res.status === 206) sniffed = sniffMediaType(new Uint8Array(await res.arrayBuffer()).subarray(0, 32));
    } catch {
      sniffed = null;
    }
  }
  if (sniffed !== input.mimeType) {
    await discard();
    return { ok: false, error: 'El contenido del archivo no coincide con su tipo. Usa un PNG, JPG, WebP, MP4 o WebM real.' };
  }

  // Tope de la clase, ya contando este archivo (que existe en Storage pero aun no en la tabla).
  const quota = checkClassQuota(await classUsage(supabase, input.classroomId), realSize);
  if (!quota.ok) {
    await discard();
    return { ok: false, error: quota.reason };
  }

  const { data: row, error } = await supabase
    .from('class_media' as any)
    .insert({
      classroom_id: input.classroomId,
      module_id: input.moduleId || null,
      kind: kindOfMime(input.mimeType),
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: realSize,
      alt_text: input.altText.trim(),
      caption: input.caption?.trim() || null,
      created_by: user.id,
    } as any)
    .select('id')
    .single();
  if (error || !row) {
    await discard();
    return { ok: false, error: 'No se pudo registrar el archivo (revisa que el modulo sea de esta clase).' };
  }

  revalidatePath(`/teacher/classrooms/${input.classroomId}/media`);
  return { ok: true, id: (row as any).id };
}

export async function updateMedia(
  classroomId: string,
  mediaId: string,
  patch: { moduleId?: string | null; altText?: string; caption?: string | null }
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireTeacherOfClass(classroomId);
  if (!ctx) return { ok: false, error: 'Clase no encontrada o sin permisos.' };
  const update: Record<string, unknown> = {};
  if (patch.moduleId !== undefined) update.module_id = patch.moduleId || null;
  if (patch.altText !== undefined) {
    const alt = patch.altText.trim();
    if (alt.length < 3 || alt.length > 300) return { ok: false, error: 'La descripcion debe tener entre 3 y 300 caracteres.' };
    update.alt_text = alt;
  }
  if (patch.caption !== undefined) {
    if (patch.caption && patch.caption.length > 300) return { ok: false, error: 'El pie de foto es demasiado largo.' };
    update.caption = patch.caption?.trim() || null;
  }
  if (Object.keys(update).length === 0) return { ok: true };
  const { data, error } = await ctx.supabase.from('class_media' as any).update(update as any).eq('id', mediaId).eq('classroom_id', classroomId).select('id');
  if (error || !data || data.length === 0) return { ok: false, error: 'No se pudo guardar el cambio.' };
  revalidatePath(`/teacher/classrooms/${classroomId}/media`);
  return { ok: true };
}

export async function deleteMedia(classroomId: string, mediaId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireTeacherOfClass(classroomId);
  if (!ctx) return { ok: false, error: 'Clase no encontrada o sin permisos.' };
  const { data: row } = await ctx.supabase.from('class_media' as any).select('storage_path').eq('id', mediaId).eq('classroom_id', classroomId).maybeSingle();
  if (!row) return { ok: false, error: 'Archivo no encontrado.' };
  // Primero la fila (si el archivo quedara huerfano en Storage ocupa espacio pero no se muestra).
  const { error } = await ctx.supabase.from('class_media' as any).delete().eq('id', mediaId).eq('classroom_id', classroomId);
  if (error) return { ok: false, error: 'No se pudo borrar.' };
  await ctx.supabase.storage.from(BUCKET).remove([(row as any).storage_path]);
  revalidatePath(`/teacher/classrooms/${classroomId}/media`);
  return { ok: true };
}
