-- Migration 030: chunks de material procesados con IA (resumen/puntos/clave)
-- Fase 11 · Sesion I · Fix 3 · Stud.ia
--
-- La Biblioteca de Clase (Mejora 3) mostraba el texto crudo de cada chunk —
-- una pared de texto larga que nadie lee. Esta tabla guarda, por chunk, un
-- resumen corto + puntos clave + conceptos principales generados con
-- Gemini, para mostrar ESO primero (con opcion de ver el texto completo).

CREATE TABLE IF NOT EXISTS material_chunks_processed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid NOT NULL REFERENCES material_chunks(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES teaching_materials(id) ON DELETE CASCADE,
  summary text NOT NULL,
  key_points text[] NOT NULL DEFAULT '{}',
  main_concepts text[] NOT NULL DEFAULT '{}',
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_material_chunks_processed_material ON material_chunks_processed(material_id);

ALTER TABLE material_chunks_processed ENABLE ROW LEVEL SECURITY;

-- Mismo criterio de lectura que material_chunks: estudiantes inscritos en la
-- clase del material, y el profesor dueno del material.
CREATE POLICY "students_read_processed_chunks"
  ON material_chunks_processed FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teaching_materials tm
      JOIN class_enrollments ce ON ce.classroom_id = tm.classroom_id
      WHERE tm.id = material_chunks_processed.material_id AND ce.student_id = auth.uid()
    )
  );

CREATE POLICY "teachers_read_own_processed_chunks"
  ON material_chunks_processed FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teaching_materials tm
      WHERE tm.id = material_chunks_processed.material_id AND tm.teacher_id = auth.uid()
    )
  );

-- Los permisos de INSERT/UPDATE (necesarios para el upsert que hace
-- /api/process-material-chunks con la sesion del usuario) se agregan en la
-- migracion 031.
