// Material subido como archivo Markdown (.md) o texto (.txt): ya es texto, asi que NO hace falta IA ni la
// edge function. Se descarga, se decodifica, se limpia sin aplastar la sangria de las listas y pasa por el mismo
// pipeline que enlaces, YouTube y PDF (chunkEmbedAndStore, que trocea respetando titulos y tablas).

import { sanitizeMarkdown } from './pdfMarkdown';
import { chunkEmbedAndStore, QuotaExhaustedError } from './textProcessing';

export function decodeTextFile(bytes: Uint8Array): string {
  // UTF-8 con o sin BOM. Los editores de Windows suelen guardar con BOM; sin quitarlo queda un caracter basura
  // al inicio del primer titulo.
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

export async function processTextFileMaterial(supabase: any, materialId: string): Promise<void> {
  try {
    const { data: material, error: matError } = await supabase.from('teaching_materials').select('id, storage_path').eq('id', materialId).single();
    if (matError || !material?.storage_path) throw new Error('No se encontro el archivo del material.');

    await supabase.from('teaching_materials').update({ processing_status: 'processing', processing_error: null }).eq('id', materialId);

    const { data: blob, error: dlError } = await supabase.storage.from('teaching-materials').download(material.storage_path);
    if (dlError || !blob) throw new Error(`No se pudo descargar el archivo: ${dlError?.message ?? 'desconocido'}`);

    const text = sanitizeMarkdown(decodeTextFile(new Uint8Array(await blob.arrayBuffer())));
    if (text.length < 50) throw new Error('El archivo tiene muy poco texto (<50 caracteres).');

    const { chunkCount, topics, difficulty } = await chunkEmbedAndStore(supabase, materialId, text);

    await supabase
      .from('teaching_materials')
      .update({
        extracted_text: text,
        extracted_text_preview: text.slice(0, 500),
        chunk_count: chunkCount,
        topics_detected: topics,
        estimated_difficulty: difficulty,
        extraction_method: 'deterministic',
        extraction_report: { method: 'deterministic', source: 'text_file', chars: text.length, warnings: [] },
        processing_status: 'completed',
        processing_error: null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', materialId);
  } catch (err) {
    const message =
      err instanceof QuotaExhaustedError
        ? 'Se agoto la cuota gratuita de Gemini por ahora (se usa para los embeddings). Reintenta mas tarde.'
        : ((err as Error).message ?? 'Error desconocido procesando el archivo');
    await supabase.from('teaching_materials').update({ processing_status: 'failed', processing_error: message }).eq('id', materialId);
  }
}
