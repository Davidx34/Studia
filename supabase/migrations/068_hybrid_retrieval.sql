-- Fase 2 del plan de IA (docs/AUDITORIA_IA_Y_PLAN.md): recuperacion de contexto (RAG) mas robusta.
--
-- 1. material_chunks.embedding_model: con QUE modelo y configuracion se calculo cada vector. Vectores de modelos o de
--    configuraciones distintas no son comparables entre si; sin este dato un cambio de modelo mezclaba espacios sin avisar.
--    Los 197 fragmentos existentes se marcan 'gemini-embedding-001:768:legacy' (sin taskType ni normalizar). Los nuevos
--    llevan 'gemini-embedding-001:768:rt' (RETRIEVAL_DOCUMENT + normalizado). Ver src/lib/embeddings/embed.ts.
-- 2. content_fts + indice GIN: texto completo en ESPAÑOL (raices: "mercados" ~ "mercado"). Independiente de los embeddings:
--    si Gemini no tiene cuota, la busqueda por palabras sigue encontrando el contexto.
-- 3. match_material_chunks_hybrid: fusiona el ranking vectorial y el de texto completo con RRF (reciprocal rank fusion).
--    Acepta query_embedding NULL (solo texto) y query_text NULL (solo vector). Mismo control de acceso que las funciones
--    anteriores (service_role, profesor de la clase o estudiante inscrito).
--
-- Aditiva: las funciones match_material_chunks y match_material_chunks_scoped NO se tocan (son el respaldo del codigo).

ALTER TABLE public.material_chunks ADD COLUMN IF NOT EXISTS embedding_model text;

UPDATE public.material_chunks
SET embedding_model = 'gemini-embedding-001:768:legacy'
WHERE embedding IS NOT NULL AND embedding_model IS NULL;

ALTER TABLE public.material_chunks
  ADD COLUMN IF NOT EXISTS content_fts tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_chunks_content_fts ON public.material_chunks USING gin (content_fts);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_model ON public.material_chunks (embedding_model);

CREATE OR REPLACE FUNCTION public.match_material_chunks_hybrid(
  query_embedding vector(768) DEFAULT NULL,
  query_text text DEFAULT NULL,
  classroom_id_filter uuid DEFAULT NULL,
  material_ids uuid[] DEFAULT NULL,
  match_count integer DEFAULT 20,
  vector_models text[] DEFAULT NULL,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE(
  chunk_id uuid,
  content text,
  metadata jsonb,
  material_id uuid,
  filename text,
  chunk_index integer,
  similarity double precision,
  text_rank double precision,
  vector_pos integer,
  text_pos integer,
  score double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_lexemes text;
  v_tsq tsquery;
BEGIN
  -- Mismo control que match_material_chunks: la funcion corre como su dueño, asi que se verifica a quien llama.
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id_filter AND c.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = classroom_id_filter AND ce.student_id = auth.uid())
  ) THEN
    RETURN;
  END IF;

  -- Consulta de texto con OR entre las raices (los titulos de modulo son largos: con AND casi nunca habria coincidencias).
  -- Las raices vienen de to_tsvector('spanish', ...) y se escapan como literales antes de armar la tsquery.
  IF query_text IS NOT NULL AND length(btrim(query_text)) > 0 THEN
    SELECT string_agg(format('%L', w), ' | ') INTO v_lexemes
    FROM unnest(tsvector_to_array(to_tsvector('spanish', query_text))) AS w;
    IF v_lexemes IS NOT NULL THEN
      v_tsq := to_tsquery('simple', v_lexemes);
    END IF;
  END IF;

  RETURN QUERY
  WITH scope AS (
    SELECT mc.id, mc.content, mc.metadata, mc.material_id, tm.filename, mc.chunk_index,
           mc.embedding, mc.embedding_model, mc.content_fts
    FROM public.material_chunks mc
    JOIN public.teaching_materials tm ON tm.id = mc.material_id
    WHERE tm.classroom_id = classroom_id_filter
      AND tm.processing_status = 'completed'
      AND (material_ids IS NULL OR mc.material_id = ANY(material_ids))
  ),
  vec AS (
    SELECT s.id,
           1 - (s.embedding <=> query_embedding) AS sim,
           row_number() OVER (ORDER BY s.embedding <=> query_embedding) AS rk
    FROM scope s
    WHERE query_embedding IS NOT NULL
      AND s.embedding IS NOT NULL
      AND (vector_models IS NULL OR s.embedding_model = ANY(vector_models))
    ORDER BY s.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  fts AS (
    SELECT s.id,
           ts_rank_cd(s.content_fts, v_tsq) AS tr,
           row_number() OVER (ORDER BY ts_rank_cd(s.content_fts, v_tsq) DESC) AS rk
    FROM scope s
    WHERE v_tsq IS NOT NULL AND s.content_fts @@ v_tsq
    ORDER BY ts_rank_cd(s.content_fts, v_tsq) DESC
    LIMIT match_count * 2
  )
  SELECT s.id, s.content, s.metadata, s.material_id, s.filename, s.chunk_index,
         COALESCE(vec.sim, 0)::double precision,
         COALESCE(fts.tr, 0)::double precision,
         vec.rk::integer,
         fts.rk::integer,
         (COALESCE(1.0 / (rrf_k + vec.rk), 0) + COALESCE(1.0 / (rrf_k + fts.rk), 0))::double precision
  FROM scope s
  LEFT JOIN vec ON vec.id = s.id
  LEFT JOIN fts ON fts.id = s.id
  WHERE vec.id IS NOT NULL OR fts.id IS NOT NULL
  ORDER BY 11 DESC, s.chunk_index
  LIMIT match_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.match_material_chunks_hybrid(vector, text, uuid, uuid[], integer, text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_material_chunks_hybrid(vector, text, uuid, uuid[], integer, text[], integer) TO authenticated, service_role;
