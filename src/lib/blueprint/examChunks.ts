// Recuperar del material de la clase los trozos que respaldan UNA comprension en UN modulo, para que la IA escriba preguntas de examen apoyadas en ellos. Usa la busqueda hibrida que ya
// existe (vectores + texto, match_material_chunks_hybrid) acotada a la clase. El cliente es el de SERVICIO y la clase ya fue comprobada como del profesor por quien llama: la funcion de la
// base no se fia del cliente, asi que el filtro por clase es lo unico que impide leer material ajeno.
//
// Devuelve [] ante cualquier falla (la funcion no existe, sin material procesado): quien llama lo trata como "no hay material", nunca como un error que invente preguntas.

import { embedQuery, QUERYABLE_PROFILES } from '@/lib/embeddings/embed';
import { RAG_TEXT_WEIGHT } from '@/lib/rag/retrieve';
import type { SourceChunk } from './examGenerate';

export const CHUNK_RETRIEVAL = { candidates: 12, maxChunks: 6, queryChars: 400 } as const;

type Embed = (text: string) => Promise<number[] | null>;

export async function retrieveExamChunks(admin: any, args: { classroomId: string; query: string; embed?: Embed }): Promise<SourceChunk[]> {
  const query = args.query.replace(/\s+/g, ' ').trim().slice(0, CHUNK_RETRIEVAL.queryChars);
  if (!query) return [];
  try {
    const embedding = await (args.embed ?? embedQuery)(query);
    const { data, error } = await admin.rpc('match_material_chunks_hybrid', {
      query_embedding: embedding,
      query_text: query,
      classroom_id_filter: args.classroomId,
      material_ids: null,
      match_count: CHUNK_RETRIEVAL.candidates,
      vector_models: QUERYABLE_PROFILES,
      vector_weight: 1.0,
      text_weight: RAG_TEXT_WEIGHT,
    });
    if (error) {
      console.warn('[EXAM_CHUNKS_UNAVAILABLE]', String(error.message ?? error).slice(0, 200));
      return [];
    }
    const out: SourceChunk[] = [];
    const seen = new Set<string>();
    for (const r of (data ?? []) as { content?: unknown; material_id?: unknown; chunk_index?: unknown; filename?: unknown }[]) {
      if (typeof r.content !== 'string' || !r.content.trim() || typeof r.material_id !== 'string' || typeof r.chunk_index !== 'number' || !Number.isInteger(r.chunk_index) || r.chunk_index < 0) continue;
      const key = `${r.material_id}:${r.chunk_index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ materialId: r.material_id, chunkIndex: r.chunk_index, materialName: typeof r.filename === 'string' && r.filename ? r.filename : 'Material de la clase', text: r.content });
      if (out.length >= CHUNK_RETRIEVAL.maxChunks) break;
    }
    return out;
  } catch (e) {
    console.warn('[EXAM_CHUNKS_ERROR]', e instanceof Error ? e.message : 'desconocido');
    return [];
  }
}
