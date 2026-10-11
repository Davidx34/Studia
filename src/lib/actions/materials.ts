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
import { processLinkMaterial } from '@/lib/materials/processLink';
import { processPdfMaterial, PDF_MIME } from '@/lib/materials/processPdf';
import { runInBackground } from '@/lib/server/background';
import { createAdminSupabase, hasServiceRoleKey } from '@/lib/supabase/admin';
import { parseSafeUrl, UnsafeUrlError } from '@/lib/security/safeFetch';
import { claimProcessing, validateUploadInput } from '@/lib/security/materialGuards';
import { processTextFileMaterial } from '@/lib/materials/processTextFile';
import { TEXT_MIME_TYPES } from '@/lib/materials/constants';
import { processNotebookLMMaterial } from '@/lib/materials/processNotebookLM';

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

  // Lo que manda el navegador no se acepta tal cual: la ruta debe estar dentro de la carpeta de ESTA clase, el tipo
  // debe coincidir con la extension y el tamaño estar dentro del limite.
  const valid = validateUploadInput(input);
  if (!valid.ok) return { ok: false, error: valid.reason };

  // El tamaño REAL sale de Storage, no del navegador. El bucket ya aplica el limite al subir; esto ademas comprueba
  // que el archivo exista y que lo declarado no mienta.
  const slash = input.storagePath.lastIndexOf('/');
  const folder = input.storagePath.slice(0, slash);
  const baseName = input.storagePath.slice(slash + 1);
  const { data: listed } = await supabase.storage.from(STORAGE_BUCKET).list(folder, { search: baseName, limit: 5 });
  const stored = (listed ?? []).find((f: any) => f.name === baseName);
  if (!stored) return { ok: false, error: 'No encontramos el archivo subido. Intenta subirlo de nuevo.' };
  const realSize = Number((stored as any).metadata?.size ?? input.sizeBytes);
  if (!Number.isFinite(realSize) || realSize <= 0 || realSize > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: 'El archivo esta vacio o excede 10 MB.' };
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
      size_bytes: realSize,
      content_hash: input.contentHash ?? null,
      processing_status: 'pending',
      processing_started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'No se pudo registrar el material.' };
  }

  if (input.mimeType === PDF_MIME) {
    // Los PDFs se convierten a Markdown con vision: tarda entre unos segundos y un par de minutos segun las
    // paginas. Se procesa EN SEGUNDO PLANO: la subida responde al instante y la lista de materiales (que ya
    // consulta el estado cada pocos segundos) muestra "Procesando" y luego el resultado. Si falla, el material
    // queda en 'failed' con el motivo y se puede reprocesar.
    // Se usa la llave de servicio porque el trabajo sigue DESPUES de responder, cuando ya no se puede contar con
    // las cookies de la sesion. La propiedad del material ya quedo verificada arriba (clase propia + insercion
    // bajo RLS), asi que aqui solo se procesa el material que acaba de registrarse.
    // Si el servidor no tiene la llave de servicio, se procesa EN la peticion con la sesion del profesor (como antes):
    // mas lento para quien sube, pero funciona. Antes esto reventaba con "supabaseKey is required".
    if (hasServiceRoleKey()) runInBackground(processPdfMaterial(createAdminSupabase(), data.id));
    else await processPdfMaterial(supabase, data.id);
  } else if (TEXT_MIME_TYPES.includes(input.mimeType)) {
    // Markdown / texto: ya es texto, no hace falta IA ni edge function.
    await processTextFileMaterial(supabase, data.id);
  } else {
    // Word/Excel: edge function process-material (best-effort, no bloqueante).
    // Si la function NO está deployed, la fila queda en 'pending' y se puede
    // reprocesar luego con reprocessMaterial.
    await supabase.functions
      .invoke('process-material', { body: { material_id: data.id } })
      .catch(() => {
        // Silencioso: el row quedó en pending y el UI lo muestra
      });
  }

  revalidatePath(`/teacher/classrooms/${input.classroomId}/materials`);
  return { ok: true, materialId: data.id };
}

// ============================================================
// addLinkMaterial / addNotebookLMMaterial (Sesion K)
// ============================================================
//
// A diferencia de confirmMaterialUpload (que dispara la edge function y
// vuelve enseguida), estas dos esperan el procesamiento completo antes de
// responder: no hay archivo que subir de por medio, así que el "trabajo
// pesado" (scraping + embeddings) es lo único que hay que
// esperar, y mantenerlo en el mismo request evita duplicar la lógica de
// scraping/transcripción en una ruta API aparte (mismo patrón que se usó
// para regenerateModulePool en Mejora Estructural 2).

export interface AddMaterialResult {
  ok: boolean;
  materialId?: string;
  error?: string;
}

export async function addLinkMaterial(classroomId: string, url: string): Promise<AddMaterialResult> {
  const { supabase, user } = await requireUser();

  if (!(await requireClassroomOwnership(supabase, classroomId, user.id))) {
    return { ok: false, error: 'Clase no encontrada o sin permisos.' };
  }

  // Se rechaza ANTES de registrar el material: direcciones internas, credenciales en la URL, puertos raros...
  try {
    parseSafeUrl(url);
  } catch (e) {
    return { ok: false, error: e instanceof UnsafeUrlError ? e.message : 'URL inválida.' };
  }

  const { data, error } = await supabase
    .from('teaching_materials')
    .insert({
      classroom_id: classroomId,
      teacher_id: user.id,
      filename: url,
      display_name: url,
      source_type: 'link',
      external_url: url,
      processing_status: 'processing',
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'No se pudo registrar el link.' };
  }

  await processLinkMaterial(supabase, data.id, url);

  revalidatePath(`/teacher/classrooms/${classroomId}/materials`);
  return { ok: true, materialId: data.id };
}

// El profesor procesa el video/fuente externamente con NotebookLM y pega
// aqui el markdown resultante (notas/resumen estructurado). No hay fetch
// externo: es sincrono y no puede fallar por bloqueos de terceros.
export async function addNotebookLMMaterial(
  classroomId: string,
  title: string,
  markdown: string
): Promise<AddMaterialResult> {
  const { supabase, user } = await requireUser();

  if (!(await requireClassroomOwnership(supabase, classroomId, user.id))) {
    return { ok: false, error: 'Clase no encontrada o sin permisos.' };
  }

  const trimmedTitle = title.trim();
  const trimmedMarkdown = markdown.trim();
  if (!trimmedTitle) {
    return { ok: false, error: 'El título no puede estar vacío.' };
  }
  if (!trimmedMarkdown) {
    return { ok: false, error: 'El contenido pegado no puede estar vacío.' };
  }

  const { data, error } = await supabase
    .from('teaching_materials')
    .insert({
      classroom_id: classroomId,
      teacher_id: user.id,
      filename: trimmedTitle,
      display_name: trimmedTitle,
      source_type: 'notebooklm',
      processing_status: 'processing',
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'No se pudo registrar el material.' };
  }

  await processNotebookLMMaterial(supabase, data.id, trimmedMarkdown);

  revalidatePath(`/teacher/classrooms/${classroomId}/materials`);
  return { ok: true, materialId: data.id };
}

// ============================================================
// reprocessMaterial
// ============================================================

export async function reprocessMaterial(materialId: string) {
  const { supabase, user } = await requireUser();

  const { data: material } = await supabase
    .from('teaching_materials')
    .select('id, classroom_id, source_type, external_url, extracted_text, mime_type')
    .eq('id', materialId)
    .eq('teacher_id', user.id)
    .single();

  if (!material) {
    return { ok: false as const, error: 'Material no encontrado o sin permisos.' };
  }

  // No se reprocesa un material que ya se esta procesando ni uno procesado hace segundos: cada procesamiento gasta
  // cuota de IA (embeddings y, en PDF, vision).
  const claim = await claimProcessing(supabase, materialId);
  if (!claim.ok) return { ok: false as const, error: claim.reason ?? 'No se puede reprocesar ahora.' };

  // Reset status a processing/pending
  const { error: updateErr } = await supabase
    .from('teaching_materials')
    .update({
      processing_status: material.source_type === 'file' ? 'pending' : 'processing',
      processing_error: null,
      processed_at: null,
    })
    .eq('id', materialId);

  if (updateErr) return { ok: false as const, error: updateErr.message };

  // Borrar chunks viejos para que se regeneren — excepto para notebooklm, donde chunkEmbedAndStore ya borra los viejos internamente
  // solo despues de calcular los embeddings nuevos con exito (ver
  // textProcessing.ts), para no perder contenido bueno si el reintento
  // vuelve a fallar.
  // Los PDF tambien: se procesan in-process con chunkEmbedAndStore.
  const isPdfFile = material.source_type === 'file' && material.mime_type === PDF_MIME;
  const isTextFile = material.source_type === 'file' && !!material.mime_type && TEXT_MIME_TYPES.includes(material.mime_type);
  if (material.source_type !== 'notebooklm' && !isPdfFile && !isTextFile) {
    await supabase.from('material_chunks').delete().eq('material_id', materialId);
  }

  // Invalidar cache de lecciones de la clase (puede haber preguntas basadas en
  // chunks viejos)
  await supabase.rpc('invalidate_lesson_cache', {
    p_classroom_id: material.classroom_id,
  });

  // Sesion K: los links se reprocesan in-process (mismo pipeline que al
  // crearlos); los archivos siguen yendo por la edge function.
  if (material.source_type === 'link' && material.external_url) {
    await processLinkMaterial(supabase, materialId, material.external_url);
  } else if (material.source_type === 'notebooklm') {
    // No hay URL externa que re-descargar: reprocesar re-chunkea/re-embebe
    // el mismo texto pegado que ya se guardo en extracted_text la primera
    // vez (util si solo fallo el paso de embedding, ver textProcessing.ts).
    if (material.extracted_text) {
      await processNotebookLMMaterial(supabase, materialId, material.extracted_text);
    } else {
      await supabase
        .from('teaching_materials')
        .update({ processing_status: 'failed', processing_error: 'No hay texto guardado para reprocesar. Vuelve a crear el material pegando el markdown.' })
        .eq('id', materialId);
    }
  } else if (isPdfFile) {
    // En segundo plano, igual que al subirlo (ver confirmMaterialUpload). La propiedad ya se verifico arriba.
    if (hasServiceRoleKey()) runInBackground(processPdfMaterial(createAdminSupabase(), materialId));
    else await processPdfMaterial(supabase, materialId);
  } else if (isTextFile) {
    await processTextFileMaterial(supabase, materialId);
  } else {
    await supabase.functions
      .invoke('process-material', { body: { material_id: materialId } })
      .catch(() => {});
  }

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

  // Best-effort: borrar archivo de Storage (si falla seguimos). Materiales
  // de tipo link/notebooklm no tienen storage_path.
  if (material.storage_path) {
    await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([material.storage_path])
      .catch(() => {});
  }

  // Borrar fila DB (cascade limpia material_chunks)
  const { error } = await supabase
    .from('teaching_materials')
    .delete()
    .eq('id', materialId);

  if (error) return { ok: false as const, error: error.message };

  // Invalidar cache de lecciones (las que se generaron con este material ya no son válidas)
  await supabase.rpc('invalidate_lesson_cache', {
    p_classroom_id: material.classroom_id,
  });

  revalidatePath(`/teacher/classrooms/${material.classroom_id}/materials`);
  return { ok: true as const };
}
