import { embedQuery, QUERYABLE_PROFILES } from '@/lib/embeddings/embed';
import { buildQueryVariants } from './queries';
import { dropNearDuplicates, fuseVariants, joinContext, packByRelevance, relativeCutoff, type Retrieved } from './fusion';

// Recuperacion de contexto para un modulo (RAG), en tres capas:
//   1. HIBRIDA: cada consulta del modulo se busca por vectores Y por texto completo en español (RRF en la base,
//      match_material_chunks_hybrid), y los rankings de las distintas consultas se fusionan (RRF).
//   2. Sin embeddings (Gemini sin cuota o sin llave): solo texto. Sigue encontrando contexto por relevancia en vez de
//      caer a "los primeros fragmentos del documento".
//   3. Si la funcion hibrida no existe o falla: devuelve null y el llamador usa el camino anterior (vector puro).

export type Strategy = 'hybrid' | 'vector' | 'text';

export interface RetrieveOptions {
  charLimit: number;
  maxChunks?: number;
  candidatesPerQuery?: number;
  // Solo evaluaciones: fuerza una estrategia para compararlas.
  strategy?: Strategy;
  embed?: (text: string) => Promise<number[] | null>;
}

export interface RetrieveResult {
  context: string;
  chunkIds: string[];
  mode: 'hybrid' | 'text_only' | 'vector_only';
  variants: number;
  scoped: boolean;
}

// Peso del ranking de TEXTO frente al vectorial en la fusion (RRF). Con peso 1 (igual) la medicion del 2026-10-12 mostro que el
// texto, con las raices de toda la consulta unidas por OR, mete ruido y empeora el primer puesto frente al vector solo. El valor
// inicial es PROVISIONAL (la medicion da la direccion, no la magnitud): se afina con `npm run eval:retrieval -- --barrido` y se
// puede cambiar sin desplegar con la variable de entorno RAG_TEXT_WEIGHT (0 a 2).
function readTextWeight(): number {
  const n = Number(process.env.RAG_TEXT_WEIGHT);
  return Number.isFinite(n) && n >= 0 && n <= 2 && process.env.RAG_TEXT_WEIGHT !== undefined && process.env.RAG_TEXT_WEIGHT !== '' ? n : 0.3;
}
export const RAG_TEXT_WEIGHT = readTextWeight();

const DEFAULT_MAX_CHUNKS = 8;
const DEFAULT_CANDIDATES = 12;

function toRetrieved(r: any): Retrieved {
  return {
    chunk_id: String(r.chunk_id),
    content: String(r.content ?? ''),
    material_id: String(r.material_id),
    chunk_index: Number(r.chunk_index ?? 0),
    filename: r.filename ?? null,
    score: Number(r.score ?? 0),
  };
}

// null = no se pudo (modulo inexistente, funcion no disponible, sin resultados): el llamador usa el camino anterior.
export async function retrieveContext(supabase: any, moduleId: string, opts: RetrieveOptions): Promise<RetrieveResult | null> {
  const strategy = opts.strategy ?? 'hybrid';
  const { data: moduleRow } = await supabase
    .from('content_modules')
    .select('title, description, classroom_id, source_material_ids, topic_keywords')
    .eq('id', moduleId)
    .single();
  if (!moduleRow?.classroom_id) return null;

  const variants = buildQueryVariants({ title: moduleRow.title, description: moduleRow.description, keywords: moduleRow.topic_keywords });
  if (variants.length === 0) return null;

  const embed = opts.embed ?? embedQuery;
  const embeddings: (number[] | null)[] = await Promise.all(variants.map((v) => (strategy === 'text' ? Promise.resolve(null) : embed(v))));

  const scopedIds: string[] = Array.isArray(moduleRow.source_material_ids) ? moduleRow.source_material_ids : [];
  const candidates = opts.candidatesPerQuery ?? DEFAULT_CANDIDATES;

  const search = (materialIds: string[] | null) =>
    Promise.all(
      variants.map((v, i) =>
        supabase.rpc('match_material_chunks_hybrid', {
          query_embedding: embeddings[i],
          query_text: strategy === 'vector' ? null : v,
          classroom_id_filter: moduleRow.classroom_id,
          material_ids: materialIds,
          match_count: candidates,
          vector_models: QUERYABLE_PROFILES,
          vector_weight: 1.0,
          text_weight: RAG_TEXT_WEIGHT,
        })
      )
    );

  const toLists = (results: any[]): Retrieved[][] | null => {
    const errors = results.filter((r) => r?.error);
    if (errors.length === results.length) {
      console.warn('[RAG_HYBRID_UNAVAILABLE]', { moduleId, error: String(errors[0].error?.message ?? errors[0].error).slice(0, 200) });
      return null; // la funcion no existe o falla: camino anterior
    }
    return results.map((r) => ((r?.data ?? []) as any[]).map(toRetrieved));
  };

  let scoped = scopedIds.length > 0;
  let lists = toLists(await search(scoped ? scopedIds : null));
  if (!lists) return null;
  // Material vinculado sin resultados: se busca en toda la clase (igual que antes, el acotamiento no deja sin contexto).
  if (scoped && lists.every((l) => l.length === 0)) {
    scoped = false;
    lists = toLists(await search(null));
    if (!lists) return null;
  }
  if (lists.every((l) => l.length === 0)) return null;

  const fused = fuseVariants(lists);
  const kept = dropNearDuplicates(relativeCutoff(fused));
  const packed = packByRelevance(kept, opts.charLimit, opts.maxChunks ?? DEFAULT_MAX_CHUNKS);
  if (packed.length === 0) return null;

  const hasVectors = embeddings.some((e) => e !== null);
  return {
    context: joinContext(packed),
    chunkIds: packed.map((c) => c.chunk_id),
    mode: strategy === 'vector' ? 'vector_only' : hasVectors ? 'hybrid' : 'text_only',
    variants: variants.length,
    scoped,
  };
}
