-- Busqueda semantica DENTRO de los materiales que el profesor vinculo a un
-- modulo (content_modules.source_material_ids).
--
-- Por que existe: getRagContext tenia dos caminos y el "bueno" (busqueda
-- semantica via match_material_chunks) solo corria cuando el modulo NO tenia
-- materiales vinculados. Si el profesor si los vinculaba -- que es la accion
-- correcta y la que la UI de objetivos le pide -- el codigo abandonaba el RAG
-- y tomaba los primeros 12 chunks por chunk_index, es decir el principio del
-- documento, sin ninguna relacion con el tema del modulo.
--
-- Medido en produccion antes de este fix, clase "Civilizaciones Antiguas":
-- los 8 modulos comparten los mismos 3 source_material_ids (87 chunks), y los
-- 8 recibian contexto byte a byte identico de 3706 chars = 2 de 87 chunks
-- (2,3% del material). Los modulos de Grecia, Roma y Mitologia recibian CERO
-- caracteres de Doc2_Grecia_y_Roma.docx: se le pedia al modelo generar
-- preguntas sobre Grecia a partir de un texto sobre Mesopotamia y China.
--
-- Esta funcion permite pedir lo mismo que match_material_chunks pero acotado a
-- un conjunto de materiales, para que vincular material MEJORE la pertinencia
-- en vez de desactivar la busqueda.
--
-- Seguridad: SECURITY DEFINER como match_material_chunks (necesita leer chunks
-- sin depender de la RLS del llamador), pero se exige ADEMAS classroom_id para
-- que un material_id arbitrario no pueda usarse para leer chunks de otra clase.
-- El unico llamador (getRagContext) ya obtuvo ambos de la misma fila de
-- content_modules leida bajo RLS del usuario.

CREATE OR REPLACE FUNCTION public.match_material_chunks_scoped(
  query_embedding vector(768),
  material_ids uuid[],
  classroom_id_filter uuid,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  chunk_id uuid,
  content text,
  metadata jsonb,
  similarity double precision,
  material_id uuid,
  filename text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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
  WHERE mc.material_id = ANY(material_ids)
    AND tm.classroom_id = classroom_id_filter
    AND tm.processing_status = 'completed'
    AND mc.embedding IS NOT NULL
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_material_chunks_scoped IS
  'Como match_material_chunks, pero acotada a content_modules.source_material_ids. Ver migracion 043.';
