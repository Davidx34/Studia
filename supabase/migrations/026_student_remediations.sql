-- Migration 026: repaso dirigido automatico (student_remediations)
-- Fase 11 · Sesion E.1 · Stud.ia
--
-- Registra cuando un estudiante completa un modulo con <80% general y
-- se le ofrece un repaso corto enfocado en sus conceptos mas debiles
-- (<70% de acierto). Las preguntas del repaso son efimeras (no se
-- guardan en lesson_questions, se generan on-the-fly y se descartan),
-- pero el HECHO de haber hecho el repaso y su resultado si se guarda
-- aqui para que el profesor tenga visibilidad (Sesion C/futuras).

CREATE TABLE IF NOT EXISTS student_remediations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES content_modules(id) ON DELETE CASCADE,
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  concept_tags text[] NOT NULL,
  was_offered boolean NOT NULL DEFAULT true,
  was_accepted boolean NOT NULL DEFAULT false,
  was_completed boolean NOT NULL DEFAULT false,
  score_percent integer,
  bonus_xp_earned integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_student_remediations_student_id ON student_remediations(student_id);
CREATE INDEX IF NOT EXISTS idx_student_remediations_classroom_id ON student_remediations(classroom_id);

ALTER TABLE student_remediations ENABLE ROW LEVEL SECURITY;

-- Estudiantes ven y registran sus propios repasos.
CREATE POLICY "students_read_own_remediations"
  ON student_remediations FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "students_insert_own_remediations"
  ON student_remediations FOR INSERT
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "students_update_own_remediations"
  ON student_remediations FOR UPDATE
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- Profesores ven los repasos de las clases que dictan.
CREATE POLICY "teachers_read_classroom_remediations"
  ON student_remediations FOR SELECT
  USING (
    classroom_id IN (
      SELECT c.id FROM classrooms c WHERE c.teacher_id = auth.uid()
    )
  );
