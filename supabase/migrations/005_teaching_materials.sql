-- Migration 005: teaching_materials table
-- Fase 11.A · Stud.ia
--
-- Tabla de materiales didácticos subidos por el profesor a una clase.
-- Cada fila apunta a un archivo en Storage (bucket teaching-materials),
-- guarda el texto extraído y el estado del pipeline de procesamiento.
--
-- Lifecycle del processing_status:
--   pending → processing → completed | failed
--
-- Relaciones:
--   classroom_id → classrooms(id) ON DELETE CASCADE
--   teacher_id   → profiles(id)   ON DELETE CASCADE
--
-- RLS:
--   - Profesor: full CRUD sobre los suyos
--   - Estudiante: SELECT solo si está inscrito en la clase

CREATE TABLE public.teaching_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  display_name TEXT,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  extracted_text TEXT,
  extracted_text_preview TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  processing_error TEXT,
  content_hash TEXT,
  chunk_count INTEGER DEFAULT 0,
  topics_detected TEXT[],
  estimated_difficulty INTEGER CHECK (estimated_difficulty IS NULL OR estimated_difficulty BETWEEN 1 AND 10),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_materials_classroom ON public.teaching_materials(classroom_id);
CREATE INDEX idx_materials_status ON public.teaching_materials(processing_status);
CREATE INDEX idx_materials_teacher ON public.teaching_materials(teacher_id);

ALTER TABLE public.teaching_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers see own materials" ON public.teaching_materials
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "Students see materials of their classes" ON public.teaching_materials
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.class_enrollments ce
      WHERE ce.classroom_id = teaching_materials.classroom_id
        AND ce.student_id = auth.uid()
    )
  );

CREATE POLICY "Teachers insert own materials" ON public.teaching_materials
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Teachers update own materials" ON public.teaching_materials
  FOR UPDATE USING (teacher_id = auth.uid()) WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Teachers delete own materials" ON public.teaching_materials
  FOR DELETE USING (teacher_id = auth.uid());
