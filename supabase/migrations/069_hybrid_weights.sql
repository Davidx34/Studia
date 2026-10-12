-- Pesos en la busqueda hibrida (ajuste de la fase 2, docs/AUDITORIA_IA_Y_PLAN.md).
--
-- La primera medicion real (npm run eval:retrieval, 2026-10-12, 30 consultas por aula) mostro que la fusion con peso IGUAL
-- (RRF 1:1) es peor que el vector solo en el primer puesto (Hit@1 0,83 vs 0,93 en 5to grado; 0,50 vs 0,73 en
-- Microeconomia): el texto, con las raices de toda la consulta unidas por OR, mete ruido. El recall en los 5 primeros es casi
-- igual. Se agregan los pesos vector_weight y text_weight (por defecto 1 y 1: el comportamiento anterior) para poder
-- darle al texto un peso menor sin tocar la funcion cada vez. El valor a usar lo decide el barrido de eval:retrieval.
--
-- Se reemplaza la funcion de la 068 (cambia la firma: dos parametros nuevos con valor por defecto, asi los llamadores
-- anteriores siguen funcionando).

DROP FUNCTION IF EXISTS public.match_material_chunks_hybrid(vector, text, uuid, uuid[], integer, text[], integer);

CREATE OR REPLACE FUNCTION public.match_material_chunks_hybrid(
  query_embedding vector(768) DEFAULT NULL,
  query_text text DEFAULT NULL,
  classroom_id_filter uuid DEFAULT NULL,
  material_ids uuid[] DEFAULT NULL,
  match_count integer DEFAULT 20,
  vector_models text[] DEFAULT NULL,
  rrf_k integer DEFAULT 60,
  vector_weight double precision DEFAULT 1.0,
  text_weight double precision DEFAULT 1.0
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
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id_filter AND c.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = classroom_id_filter AND ce.student_id = auth.uid())
  ) THEN
    RETURN;
  END IF;

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
         (COALESCE(vector_weight / (rrf_k + vec.rk), 0) + COALESCE(text_weight / (rrf_k + fts.rk), 0))::double precision
  FROM scope s
  LEFT JOIN vec ON vec.id = s.id
  LEFT JOIN fts ON fts.id = s.id
  WHERE vec.id IS NOT NULL OR fts.id IS NOT NULL
  ORDER BY 11 DESC, s.chunk_index
  LIMIT match_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.match_material_chunks_hybrid(vector, text, uuid, uuid[], integer, text[], integer, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_material_chunks_hybrid(vector, text, uuid, uuid[], integer, text[], integer, double precision, double precision) TO authenticated, service_role;
