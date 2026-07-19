-- Migration 029: notas personales del estudiante sobre materiales de clase
-- Fase 11 · Mejora 3 · Stud.ia
--
-- Una nota por (estudiante, material): el estudiante puede repasar el
-- material original de su profesor (teaching_materials/material_chunks,
-- ya legibles vía RLS existente) y tomar notas propias mientras lee.

CREATE TABLE IF NOT EXISTS study_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES teaching_materials(id) ON DELETE CASCADE,
  notes_content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_study_notes_student_material ON study_notes(student_id, material_id);

ALTER TABLE study_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_manage_own_notes"
  ON study_notes FOR ALL
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());
