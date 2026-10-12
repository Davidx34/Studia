-- Paso 2 de la fase 2b (docs/AUDITORIA_IA_Y_PLAN.md): un vector POR FRAGMENTO Y POR PERFIL, con dimension libre.
--
-- Hoy material_chunks.embedding es vector(768) fijo: solo cabe UN modelo y 768 dimensiones. Los proveedores gratuitos con
-- lotes (Cloudflare bge-m3, Voyage, Mistral) usan 1.024. Esta tabla guarda varios vectores por fragmento, cada uno con su
-- perfil (modelo + dimensiones + configuracion), y la busqueda elige el perfil. Vectores de perfiles distintos NUNCA se comparan.
--
-- Aditiva y SIN cambios de codigo necesarios:
--   1. material_chunk_embeddings (dimension libre, solo accesible por el servidor; la leen las funciones SECURITY DEFINER).
--   2. Relleno desde material_chunks (los fragmentos actuales) y un DISPARADOR que la mantiene sincronizada mientras el
--      codigo siga escribiendo en material_chunks.embedding (la columna vieja se retira en el paso 5).
--   3. match_material_chunks_hybrid acepta query_embedding de cualquier dimension y `vector_profile`: con perfil, busca en la
--      tabla nueva; sin perfil, se comporta como hasta ahora (compatibilidad).
--   4. classroom_embedding_coverage: que perfiles tiene indexados una clase y cuantos fragmentos cubre cada uno (para elegir
--      con cual consultar).

CREATE TABLE IF NOT EXISTS public.material_chunk_embeddings (
  chunk_id uuid NOT NULL REFERENCES public.material_chunks(id) ON DELETE CASCADE,
  profile text NOT NULL,
  dims integer NOT NULL CHECK (dims > 0),
  embedding vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, profile),
  CONSTRAINT embedding_dims_match CHECK (vector_dims(embedding) = dims)
);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_profile ON public.material_chunk_embeddings (profile);

ALTER TABLE public.material_chunk_embeddings ENABLE ROW LEVEL SECURITY;
-- Sin ningun permiso para la app: solo service_role (que se salta la RLS) y las funciones SECURITY DEFINER.
REVOKE ALL ON public.material_chunk_embeddings FROM PUBLIC, anon, authenticated;

-- Relleno: lo que ya hay (perfil = embedding_model, 768 dimensiones).
INSERT INTO public.material_chunk_embeddings (chunk_id, profile, dims, embedding)
SELECT id, embedding_model, 768, embedding::vector
FROM public.material_chunks
WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL
ON CONFLICT (chunk_id, profile) DO NOTHING;

-- Sincronizacion mientras la columna vieja siga en uso.
CREATE OR REPLACE FUNCTION public.sync_chunk_embedding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.embedding IS NOT NULL AND NEW.embedding_model IS NOT NULL THEN
    INSERT INTO public.material_chunk_embeddings (chunk_id, profile, dims, embedding)
    VALUES (NEW.id, NEW.embedding_model, 768, NEW.embedding::vector)
    ON CONFLICT (chunk_id, profile) DO UPDATE SET embedding = EXCLUDED.embedding, dims = EXCLUDED.dims, created_at = now();
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_chunk_embedding() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_chunk_embedding ON public.material_chunks;
CREATE TRIGGER trg_sync_chunk_embedding
  AFTER INSERT OR UPDATE OF embedding, embedding_model ON public.material_chunks
  FOR EACH ROW EXECUTE FUNCTION public.sync_chunk_embedding();

-- Busqueda hibrida: consulta de CUALQUIER dimension y perfil opcional. Reemplaza la de la 069 (cambia la firma: query_embedding
-- pasa de vector(768) a vector y se agrega vector_profile al final con valor por defecto, asi los llamadores anteriores siguen
-- funcionando igual).
DROP FUNCTION IF EXISTS public.match_material_chunks_hybrid(vector, text, uuid, uuid[], integer, text[], integer, double precision, double precision);

CREATE OR REPLACE FUNCTION public.match_material_chunks_hybrid(
  query_embedding vector DEFAULT NULL,
  query_text text DEFAULT NULL,
  classroom_id_filter uuid DEFAULT NULL,
  material_ids uuid[] DEFAULT NULL,
  match_count integer DEFAULT 20,
  vector_models text[] DEFAULT NULL,
  rrf_k integer DEFAULT 60,
  vector_weight double precision DEFAULT 1.0,
  text_weight double precision DEFAULT 1.0,
  vector_profile text DEFAULT NULL
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
  v_qdims integer;
  v_pdims integer;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id_filter AND c.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = classroom_id_filter AND ce.student_id = auth.uid())
  ) THEN
    RETURN;
  END IF;

  -- Vectores de dimensiones distintas no se pueden comparar (y darian error): si la consulta no cuadra con el espacio
  -- elegido, la parte vectorial se apaga y la busqueda sigue solo por texto.
  IF query_embedding IS NOT NULL THEN
    v_qdims := vector_dims(query_embedding);
    IF vector_profile IS NULL THEN
      IF v_qdims <> 768 THEN query_embedding := NULL; END IF;
    ELSE
      SELECT e.dims INTO v_pdims FROM public.material_chunk_embeddings e WHERE e.profile = vector_profile LIMIT 1;
      IF v_pdims IS NULL OR v_pdims <> v_qdims THEN query_embedding := NULL; END IF;
    END IF;
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
  cand AS (
    -- Con perfil: la tabla nueva. Sin perfil: la columna vieja de 768 (comportamiento anterior).
    SELECT s.id, e.embedding AS emb
    FROM scope s
    JOIN public.material_chunk_embeddings e ON e.chunk_id = s.id AND e.profile = vector_profile
    WHERE query_embedding IS NOT NULL AND vector_profile IS NOT NULL
    UNION ALL
    SELECT s.id, s.embedding::vector AS emb
    FROM scope s
    WHERE query_embedding IS NOT NULL AND vector_profile IS NULL
      AND s.embedding IS NOT NULL
      AND (vector_models IS NULL OR s.embedding_model = ANY(vector_models))
  ),
  vec AS (
    SELECT c.id,
           1 - (c.emb <=> query_embedding) AS sim,
           row_number() OVER (ORDER BY c.emb <=> query_embedding) AS rk
    FROM cand c
    ORDER BY c.emb <=> query_embedding
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

REVOKE ALL ON FUNCTION public.match_material_chunks_hybrid(vector, text, uuid, uuid[], integer, text[], integer, double precision, double precision, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_material_chunks_hybrid(vector, text, uuid, uuid[], integer, text[], integer, double precision, double precision, text) TO authenticated, service_role;

-- Que perfiles tiene indexados una clase (o un conjunto de materiales) y a cuantos fragmentos cubre cada uno.
CREATE OR REPLACE FUNCTION public.classroom_embedding_coverage(
  classroom_id_filter uuid,
  material_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(profile text, chunks bigint, total bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id_filter AND c.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = classroom_id_filter AND ce.student_id = auth.uid())
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH scope AS (
    SELECT mc.id
    FROM public.material_chunks mc
    JOIN public.teaching_materials tm ON tm.id = mc.material_id
    WHERE tm.classroom_id = classroom_id_filter
      AND tm.processing_status = 'completed'
      AND (material_ids IS NULL OR mc.material_id = ANY(material_ids))
  ),
  total AS (SELECT count(*) AS n FROM scope)
  SELECT e.profile, count(*)::bigint, (SELECT n FROM total)::bigint
  FROM scope s
  JOIN public.material_chunk_embeddings e ON e.chunk_id = s.id
  GROUP BY e.profile
  ORDER BY count(*) DESC, e.profile;
END;
$function$;

REVOKE ALL ON FUNCTION public.classroom_embedding_coverage(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classroom_embedding_coverage(uuid, uuid[]) TO authenticated, service_role;
