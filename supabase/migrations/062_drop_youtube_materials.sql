-- Se eliminan los materiales de YouTube y todo lo propio de YouTube (autorizado por el dueño del proyecto).
--
-- Eran 18 materiales de prueba (23-jul-2026); 13 estaban vinculados a modulos. Al borrarlos:
--   * se quitan sus ids de content_modules.source_material_ids (un arreglo no tiene clave foranea: si no se limpiara
--     quedarian ids huerfanos que la generacion intentaria usar);
--   * la cascada elimina sus fragmentos, resumenes, notas y tarjetas (material_chunks, material_chunks_processed,
--     study_notes, study_cards, study_*_generation);
--   * las preguntas ya generadas de los modulos NO se tocan.
-- Despues se cierra la restriccion de source_type y se retiran las columnas que solo usaba YouTube.

UPDATE public.content_modules m
SET source_material_ids = ARRAY(
  SELECT x
  FROM unnest(m.source_material_ids) AS x
  WHERE x NOT IN (SELECT id FROM public.teaching_materials WHERE source_type = 'youtube')
)
WHERE m.source_material_ids IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.teaching_materials t
    WHERE t.source_type = 'youtube' AND t.id = ANY (m.source_material_ids)
  );

DELETE FROM public.teaching_materials WHERE source_type = 'youtube';

ALTER TABLE public.teaching_materials DROP CONSTRAINT IF EXISTS teaching_materials_source_type_check;
ALTER TABLE public.teaching_materials
  ADD CONSTRAINT teaching_materials_source_type_check
  CHECK (source_type = ANY (ARRAY['file'::text, 'link'::text, 'notebooklm'::text]));

ALTER TABLE public.teaching_materials
  DROP COLUMN IF EXISTS youtube_video_id,
  DROP COLUMN IF EXISTS transcript_source,
  DROP COLUMN IF EXISTS auto_retry_count,
  DROP COLUMN IF EXISTS duration_seconds,
  DROP COLUMN IF EXISTS thumbnail_url;
