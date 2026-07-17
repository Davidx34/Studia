-- Migration 027: planes de refuerzo personalizados (remediation_plans)
-- Fase 11 · Sesion E.2 · Stud.ia
--
-- El profesor, desde el panel "Por Estudiante", crea un plan de refuerzo
-- para un estudiante con <70% general enfocado en 2-3 conceptos debiles.
-- El estudiante lo ve en su dashboard y lo completa a su ritmo (no es
-- obligatorio), avanzando "rondas" de repaso efimero (mismo mecanismo de
-- generacion que Sesion E.1) hasta alcanzar el objetivo.

CREATE TABLE IF NOT EXISTS remediation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  target_concepts text[] NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  modules_target integer NOT NULL DEFAULT 5,
  modules_completed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_remediation_plans_student_id ON remediation_plans(student_id);
CREATE INDEX IF NOT EXISTS idx_remediation_plans_classroom_id ON remediation_plans(classroom_id);

ALTER TABLE remediation_plans ENABLE ROW LEVEL SECURITY;

-- Estudiantes ven y avanzan sus propios planes.
CREATE POLICY "students_read_own_plans"
  ON remediation_plans FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "students_update_own_plans"
  ON remediation_plans FOR UPDATE
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- Profesores crean y ven los planes de las clases que dictan.
CREATE POLICY "teachers_read_classroom_plans"
  ON remediation_plans FOR SELECT
  USING (
    classroom_id IN (
      SELECT c.id FROM classrooms c WHERE c.teacher_id = auth.uid()
    )
  );

CREATE POLICY "teachers_insert_classroom_plans"
  ON remediation_plans FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND classroom_id IN (
      SELECT c.id FROM classrooms c WHERE c.teacher_id = auth.uid()
    )
  );
