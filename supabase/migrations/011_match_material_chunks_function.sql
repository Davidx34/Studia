-- Migration 011: function match_material_chunks (RAG retrieval)
-- Fase 11.A · Stud.ia
--
-- Función de retrieval semántico para el RAG.
-- Dado un embedding de query, devuelve los top-K chunks de mayor similitud
-- (cosine similarity) DENTRO de una clase específica, filtrando solo
-- materiales con processing_status='completed'.
--
-- Usa el operador <=> de pgvector (cosine distance). similarity = 1 - distance.
--
-- SECURITY DEFINER: necesario para que un estudiante pueda ejecutarla
-- a través de la Edge Function (que invoca con su JWT) y atravesar
-- el RLS de material_chunks de forma controlada por classroom_id_filter.
-- search_path explícito para evitar hijacking de schema.
--
-- IMPORTANTE: el caller (Edge Function) DEBE validar que el student
-- pertenezca a la clase classroom_id_filter ANTES de invocarla,
-- porque esta función NO valida pertenencia (solo filtra por classroom).

CREATE OR REPLACE FUNCTION public.match_material_chunks(
  query_embedding vector(768),
  classroom_id_filter UUID,
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  chunk_id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT,
  material_id UUID,
  filename TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    mc.id AS chunk_id,
    mc.content,
    mc.metadata,
    1 - (mc.embedding <=> query_embedding) AS similarity,
    mc.material_id,
    tm.filename
  FROM public.material_chunks mc
  JOIN public.teaching_materials tm ON tm.id = mc.material_id
  WHERE tm.classroom_id = classroom_id_filter
    AND tm.processing_status = 'completed'
    AND mc.embedding IS NOT NULL
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_material_chunks TO authenticated;
