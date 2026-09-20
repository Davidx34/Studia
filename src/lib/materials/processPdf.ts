// Procesa un PDF subido: lo descarga del Storage, lo convierte a Markdown (con vision y control de
// calidad, ver pdfToMarkdown.ts) y lo pasa por el MISMO pipeline que los enlaces y YouTube
// (chunkEmbedAndStore), que troza respetando titulos y tablas.
//
// Antes los PDFs los procesaba la edge function process-material, que tiene su propia copia vieja
// del chunking (sin titulos ni tablas): los archivos subidos nunca se beneficiaban del chunking
// por Markdown. Word y Excel siguen yendo por esa edge function.

import { convertPdfToMarkdown } from './pdfToMarkdown';
import { chunkEmbedAndStore, QuotaExhaustedError } from './textProcessing';

export const PDF_MIME = 'application/pdf';

export async function processPdfMaterial(supabase: any, materialId: string): Promise<void> {
  try {
    const { data: material, error: matError } = await supabase
      .from('teaching_materials')
      .select('id, storage_path')
      .eq('id', materialId)
      .single();
    if (matError || !material?.storage_path) throw new Error('No se encontro el archivo del material.');

    await supabase
      .from('teaching_materials')
      .update({ processing_status: 'processing', processing_error: null })
      .eq('id', materialId);

    const { data: blob, error: dlError } = await supabase.storage.from('teaching-materials').download(material.storage_path);
    if (dlError || !blob) throw new Error(`No se pudo descargar el archivo: ${dlError?.message ?? 'desconocido'}`);

    const converted = await convertPdfToMarkdown(new Uint8Array(await blob.arrayBuffer()));
    if (converted.markdown.length < 50) {
      throw new Error('El texto extraido es muy corto (<50 caracteres). ¿PDF escaneado o sin texto?');
    }

    const { chunkCount, topics, difficulty } = await chunkEmbedAndStore(supabase, materialId, converted.markdown);

    await supabase
      .from('teaching_materials')
      .update({
        extracted_text: converted.markdown,
        extracted_text_preview: converted.markdown.slice(0, 500),
        chunk_count: chunkCount,
        topics_detected: topics,
        estimated_difficulty: difficulty,
        extraction_method: converted.method,
        extraction_report: converted.report,
        processing_status: 'completed',
        processing_error: null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', materialId);
  } catch (err) {
    const message =
      err instanceof QuotaExhaustedError
        ? 'Se agoto la cuota gratuita de Gemini por ahora (se usa para los embeddings). Reintenta mas tarde.'
        : ((err as Error).message ?? 'Error desconocido procesando el PDF');
    await supabase
      .from('teaching_materials')
      .update({ processing_status: 'failed', processing_error: message })
      .eq('id', materialId);
  }
}
