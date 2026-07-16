-- Migration 018: question_attempts (tracking de conceptos)
-- Fase 11 · Sesión B · Stud.ia
--
-- Registra CADA intento de respuesta (no solo el resultado final de la lección),
-- para poder agregar por concept_tag y detectar en qué conceptos específicos
-- falla cada estudiante/clase. Consumido por un futuro reporte de brechas
-- (fuera de alcance de esta sesión).

CREATE TABLE IF NOT EXISTS question_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES lesson_questions(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES content_modules(id) ON DELETE CASCADE,
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  concept_tag text,
  was_correct boolean NOT NULL,
  answer_given jsonb,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_question_attempts_student_id ON question_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_concept_tag ON question_attempts(concept_tag);
CREATE INDEX IF NOT EXISTS idx_question_attempts_classroom_id ON question_attempts(classroom_id);

ALTER TABLE question_attempts ENABLE ROW LEVEL SECURITY;

-- Estudiantes ven y registran sus propios intentos.
CREATE POLICY "students_read_own_question_attempts"
  ON question_attempts FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "students_insert_own_question_attempts"
  ON question_attempts FOR INSERT
  WITH CHECK (student_id = auth.uid());

-- Profesores ven los intentos de las clases que dictan.
CREATE POLICY "teachers_read_classroom_question_attempts"
  ON question_attempts FOR SELECT
  USING (
    classroom_id IN (
      SELECT c.id FROM classrooms c WHERE c.teacher_id = auth.uid()
    )
  );
