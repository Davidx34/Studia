-- Migration 009: extend content_modules for AI-generated maps
-- Fase 11.A · Stud.ia
--
-- Extensión ADITIVA de la tabla existente content_modules para soportar
-- módulos generados por IA a partir de material de una clase.
--
-- Columnas nuevas (todas con DEFAULT seguro, no rompen filas existentes):
--   source_material_ids  UUID[]  → IDs de teaching_materials que originaron el módulo
--   auto_generated       BOOLEAN → distingue módulos legacy (false) de los AI (true)
--   topic_keywords       TEXT[]  → tags semánticos para visualización del mapa
--
-- Índice parcial: solo indexa filas con auto_generated=true (más eficiente,
-- ya que la mayoría de queries de "módulos de mi clase" filtran por esa flag).
--
-- IMPORTANTE: NO toca columnas existentes ni datos. ADITIVA al 100%.

ALTER TABLE public.content_modules
  ADD COLUMN IF NOT EXISTS source_material_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS topic_keywords TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_modules_auto_generated
  ON public.content_modules(auto_generated)
  WHERE auto_generated = true;
