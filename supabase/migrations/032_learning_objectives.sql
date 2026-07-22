-- Migration 032: objetivos de aprendizaje + pool de preguntas activas/backup
-- Fase 11 · Mejora Estructural 2 · Stud.ia
--
-- Capa ADITIVA sobre el sistema de modulos/preguntas ya existente (no
-- reemplaza el cache incremental de lesson_questions, que sigue
-- funcionando igual para modulos auto-generados). Los objetivos son un
-- agrupador opcional que el profesor puede usar para organizar modulos
-- bajo una meta mayor, con control explicito de cuantas preguntas y que
-- tipos de minijuego se generan por modulo.

CREATE TABLE IF NOT EXISTS classroom_learning_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  expected_duration_weeks integer NOT NULL DEFAULT 4,
  difficulty_level integer NOT NULL DEFAULT 5 CHECK (difficulty_level BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_objectives_classroom ON classroom_learning_objectives(classroom_id);

ALTER TABLE classroom_learning_objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teachers_manage_own_objectives"
  ON classroom_learning_objectives FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "students_read_classroom_objectives"
  ON classroom_learning_objectives FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM class_enrollments ce
      WHERE ce.classroom_id = classroom_learning_objectives.classroom_id AND ce.student_id = auth.uid()
    )
  );

-- content_modules: vinculo opcional a un objetivo, orden dentro de el, y
-- que tipos de minijuego puede elegir el generador para este modulo
-- especifico (si es null/vacio, se usa el comportamiento actual: cualquiera).
ALTER TABLE content_modules ADD COLUMN IF NOT EXISTS learning_objective_id uuid REFERENCES classroom_learning_objectives(id) ON DELETE SET NULL;
ALTER TABLE content_modules ADD COLUMN IF NOT EXISTS order_in_objective integer;
ALTER TABLE content_modules ADD COLUMN IF NOT EXISTS minigame_types text[];
ALTER TABLE content_modules ADD COLUMN IF NOT EXISTS configured_question_count integer;

CREATE INDEX IF NOT EXISTS idx_content_modules_objective ON content_modules(learning_objective_id);

-- lesson_questions: marca de pool activo vs reserva. Los modulos que NO
-- pasan por el flujo nuevo (auto-generados como hasta ahora) quedan con
-- is_backup=false por default, asi que el filtro "solo activas" no les
-- afecta (siguen viendose todas, igual que hoy).
ALTER TABLE lesson_questions ADD COLUMN IF NOT EXISTS is_backup boolean NOT NULL DEFAULT false;
ALTER TABLE lesson_questions ADD COLUMN IF NOT EXISTS backup_pool_size integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_lesson_questions_backup ON lesson_questions(module_id, is_backup);
