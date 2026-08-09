-- Migration 042: nuevo source_type 'notebooklm' para teaching_materials
-- Fase post-piloto · Stud.ia
--
-- No intentamos que el sistema "entienda" video directamente (no hay API
-- oficial de transcripción con esa calidad sin costo/riesgo legal, ver
-- docs/AUDITORIA_TECNICA_STUDIA.md). En su lugar: el profesor procesa el
-- video externamente con NotebookLM (que sí tiene acceso privilegiado a
-- infraestructura de Google) y pega aquí el resumen/notas estructuradas en
-- markdown que NotebookLM genera. Stud.ia solo necesita chunkear+embeber
-- ese texto — mismo pipeline que ya usa para archivos y links.

ALTER TABLE public.teaching_materials DROP CONSTRAINT teaching_materials_source_type_check;
ALTER TABLE public.teaching_materials ADD CONSTRAINT teaching_materials_source_type_check
  CHECK (source_type = ANY (ARRAY['file'::text, 'link'::text, 'youtube'::text, 'notebooklm'::text]));
