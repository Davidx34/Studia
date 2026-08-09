// Material tipo "notebooklm": el profesor procesa el video (u otra fuente
// densa) externamente con NotebookLM -- que si tiene acceso privilegiado a
// infraestructura de Google para "ver"/"escuchar" contenido, cosa que este
// proyecto no puede replicar de forma legal ni gratuita (ver Sección 2 de
// docs/AUDITORIA_TECNICA_STUDIA.md sobre YouTube) -- y pega aqui las notas/
// resumen estructurado en markdown que NotebookLM genera.
//
// A diferencia de processYoutube/processLink, este pipeline NO hace ningun
// fetch externo: el contenido ya esta en manos del profesor. Por eso es
// sincrono y no puede fallar por bloqueos de terceros -- el unico fallo
// posible es que el texto pegado este vacio o que chunkEmbedAndStore falle
// (embeddings), que ya tiene reintentos (ver textProcessing.ts).

import { sanitizeText, chunkEmbedAndStore } from './textProcessing';

export async function processNotebookLMMaterial(
  supabase: any,
  materialId: string,
  markdown: string
): Promise<void> {
  try {
    const sanitized = sanitizeText(markdown);
    if (!sanitized) {
      throw new Error('El contenido pegado esta vacio despues de limpiarlo.');
    }

    const { chunkCount, topics, difficulty } = await chunkEmbedAndStore(supabase, materialId, sanitized);

    await supabase
      .from('teaching_materials')
      .update({
        processing_status: 'completed',
        processing_error: null,
        processed_at: new Date().toISOString(),
        extracted_text: sanitized,
        extracted_text_preview: sanitized.slice(0, 500),
        chunk_count: chunkCount,
        topics_detected: topics,
        estimated_difficulty: difficulty,
      })
      .eq('id', materialId);
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido procesando las notas de NotebookLM';
    await supabase
      .from('teaching_materials')
      .update({ processing_status: 'failed', processing_error: message })
      .eq('id', materialId);
  }
}
