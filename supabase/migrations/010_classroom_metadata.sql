-- Migration 010: extend classrooms with subject + grade metadata
-- Fase 11.A · Stud.ia
--
-- Agrega metadatos opcionales que el profesor elige al crear una clase
-- (selects en /teacher/classrooms/new). Se usan para:
--   - Mostrar la clase en el dashboard del estudiante
--   - Etiquetar el contexto al prompt del Map Designer (Gemini)
--
-- ADITIVA: ambas columnas son TEXT NULL, no afectan filas existentes.

ALTER TABLE public.classrooms
  ADD COLUMN IF NOT EXISTS subject_area TEXT,
  ADD COLUMN IF NOT EXISTS grade_level TEXT;
