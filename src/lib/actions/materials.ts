'use server';

// Server actions para teaching_materials
// Fase 11.C · Stud.ia
//
// Diseño de seguridad:
//   - Cada acción verifica auth + ownership de la classroom (defensa en profundidad
//     adicional al RLS).
//   - getUploadSignedUrl produce URL firmada de Storage usando el JWT del profe.
//     Las storage policies (migración 014) ya restringen INSERT al teacher dueño.
//   - confirmMaterialUpload INSERTa la fila en teaching_materials y dispara la
//     edge function process-material. Si la function no está deployed, el row
//     queda en status='pending' y puede reprocesarse luego.
//   - deleteMaterial borra primero del bucket (best-effort), después la fila.
//     Si Storage delete falla, igual borra la fila (cascade limpia chunks).
//     El archivo huérfano se puede limpiar manualmente o con un cron futuro.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/materials/constants';
import { slugifyFilename } from '@/lib/materials/file-helpers';

const STORAGE_BUCKET = 'teaching-materials';
const SIGNED_URL_TTL_SECONDS = 60 * 5; // 5 minutos

async function requireUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { supabase, user };
}

async function requireClassroomOwnership(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  classroomId: string,
  userId: string
) {
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id')
    .eq('id', classroomId)
    .eq('teacher_id', userId)
    .single();
  return !!classroom;
}

// ============================================================
// getUploadSignedUrl
// ============================================================

export interface GetUploadUrlInput {
  classroomId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface GetUploadUrlResult {
  ok: boolean;
  storagePath?: string;
  signedUrl?: string;
  token?: string;
  error?: string;
}

export async function getUploadSignedUrl(
  input: GetUploadUrlInput
): Promise<GetUploadUrlResult> {
  const { supabase, user } = await requireUser();

  // 1. Validaciones
  if (!input.filename || input.filename.length > 200) {
    return { ok: false, error: 'Nombre de archivo inválido.' };
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, error: 'Archivo vacío.' };
  }
  if (input.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `Archivo excede 10 MB.` };
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return { ok: false, error: `Tipo de archivo no permitido: ${input.mimeType}` };
  }

  // 2. Verificar ownership
  if (!(await requireClassroomOwnership(supabase, input.classroomId, user.id))) {
    return { ok: false, error: 'Clase no encontrada o sin permisos.' };
  }

  // 3. Generar storage path: {classroom_id}/{timestamp}_{slugified_filename}
  // El timestamp evita colisiones si el mismo nombre se sube dos veces.
  const safeName = slugifyFilename(input.filename);
  const storagePath = `${input.classroomId}/${Date.now()}_${safeName}`;

  // 4. Crear signed URL para upload
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'No se pudo generar URL de subida.' };
  }

  return {
    ok: true,
    storagePath,
    signedUrl: data.signedUrl,
    token: data.token,
  };
}

// ============================================================
// confirmMaterialUpload
// ============================================================

export interface ConfirmUploadInput {
  classroomId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash?: string;
}

export interface ConfirmUploadResult {
  ok: boolean;
  materialId?: string;
  error?: string;
}

export async function confirmMaterialUpload(
  input: ConfirmUploadInput
): Promise<ConfirmUploadResult> {
  const { supabase, user } = await requireUser();

  if (!(await requireClassroomOwnership(supabase, input.classroomId, user.id))) {
    return { ok: false, error: 'Clase no encontrada o sin permisos.' };
  }

  // INSERT en teaching_materials con status='pending'
  const { data, error } = await supabase
    .from('teaching_materials')
    .insert({
      classroom_id: input.classroomId,
      teacher_id: user.id,
      filename: input.filename,
      display_name: input.filename,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      content_hash: input.contentHash ?? null,
      processing_status: 'pending',
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'No se pudo registrar el material.' };
  }

  // Disparar edge function process-material (best-effort, no bloqueante).
  // Si la function NO está deployed, la fila queda en 'pending' y se puede
  // reprocesar luego con reprocessMaterial.
  await supabase.functions
    .invoke('process-material', { body: { material_id: data.id } })
    .catch(() => {
      // Silencioso: el row quedó en pending y el UI lo muestra
    });

  revalidatePath(`/teacher/classrooms/${input.classroomId}/materials`);
  return { ok: true, materialId: data.id };
}

// ============================================================
// reprocessMaterial
// ============================================================

export async function reprocessMaterial(materialId: string) {
  const { supabase, user } = await requireUser();

  const { data: material } = await supabase
    .from('teaching_materials')
    .select('id, classroom_id')
    .eq('id', materialId)
    .eq('teacher_id', user.id)
    .single();

  if (!material) {
    return { ok: false as const, error: 'Material no encontrado o sin permisos.' };
  }

  // Reset status a pending
  const { error: updateErr } = await supabase
    .from('teaching_materials')
    .update({
      processing_status: 'pending',
      processing_error: null,
      processed_at: null,
    })
    .eq('id', materialId);

  if (updateErr) return { ok: false as const, error: updateErr.message };

  // Borrar chunks viejos para que la edge function los regenere
  await supabase.from('material_chunks').delete().eq('material_id', materialId);

  // Invalidar cache de lecciones de la clase (puede haber preguntas basadas en
  // chunks viejos)
  await supabase.rpc('invalidate_lesson_cache', {
    p_classroom_id: material.classroom_id,
  } as any);

  // Disparar edge function
  await supabase.functions
    .invoke('process-material', { body: { material_id: materialId } })
    .catch(() => {});

  revalidatePath(`/teacher/classrooms/${material.classroom_id}/materials`);
  return { ok: true as const };
}

// ============================================================
// renameMaterial (cambio de display_name, NO reprocesa)
// ============================================================

export async function renameMaterial(materialId: string, newDisplayName: string) {
  const { supabase, user } = await requireUser();

  const trimmed = newDisplayName.trim();
  if (!trimmed) return { ok: false as const, error: 'Nombre vacío.' };
  if (trimmed.length > 200) return { ok: false as const, error: 'Nombre demasiado largo.' };

  const { data: material } = await supabase
    .from('teaching_materials')
    .select('id, classroom_id')
    .eq('id', materialId)
    .eq('teacher_id', user.id)
    .single();
  if (!material) return { ok: false as const, error: 'Material no encontrado.' };

  const { error } = await supabase
    .from('teaching_materials')
    .update({ display_name: trimmed })
    .eq('id', materialId);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/teacher/classrooms/${material.classroom_id}/materials`);
  return { ok: true as const };
}

// ============================================================
// deleteMaterial
// ============================================================

export async function deleteMaterial(materialId: string) {
  const { supabase, user } = await requireUser();

  // Lookup para verificar ownership y obtener storage_path + classroom
  const { data: material } = await supabase
    .from('teaching_materials')
    .select('id, classroom_id, storage_path')
    .eq('id', materialId)
    .eq('teacher_id', user.id)
    .single();

  if (!material) return { ok: false as const, error: 'Material no encontrado.' };

  // Best-effort: borrar archivo de Storage (si falla seguimos)
  await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([material.storage_path])
    .catch(() => {});

  // Borrar fila DB (cascade limpia material_chunks)
  const { error } = await supabase
    .from('teaching_materials')
    .delete()
    .eq('id', materialId);

  if (error) return { ok: false as const, error: error.message };

  // Invalidar cache de lecciones (las que se generaron con este material ya no son válidas)
  await supabase.rpc('invalidate_lesson_cache', {
    p_classroom_id: material.classroom_id,
  } as any);

  revalidatePath(`/teacher/classrooms/${material.classroom_id}/materials`);
  return { ok: true as const };
}
