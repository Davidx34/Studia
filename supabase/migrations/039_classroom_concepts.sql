-- Migration 039: classroom_concepts (Fase 1.2 post-auditoria)
-- Taxonomia cerrada de conceptos por modulo.
--
-- Problema que resuelve: hasta ahora cada pregunta generada trae su propio
-- concept_tag "libre" (el LLM inventa el snake_case en el momento). Dos
-- corridas de generacion para el MISMO modulo terminan con variantes del
-- mismo concepto ("lagrange_condiciones_primer_orden" vs
-- "condiciones_primer_orden_lagrange" vs "cpo_lagrange"), lo que rompe la
-- agregacion por concepto en question_attempts/progress_analytics (020) y
-- por tanto el reporte de brechas que ve el profesor.
--
-- Solucion: antes de generar preguntas para un modulo por primera vez, se
-- le pide al LLM una lista cerrada de 5-10 conceptos candidatos (tag +
-- label legible), se persiste aqui, y esa lista cerrada se reinyecta en
-- CADA prompt de generacion posterior para ese modulo con instruccion
-- explicita de usar EXACTAMENTE uno de esos tags. Ver
-- src/lib/questions/conceptTaxonomy.ts.

CREATE TABLE IF NOT EXISTS classroom_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES content_modules(id) ON DELETE CASCADE,
  tag text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Un mismo tag no puede significar dos cosas distintas dentro del mismo
  -- modulo. (Reutilizar el mismo tag entre modulos distintos SI esta
  -- permitido -- ej. un concepto transversal como "ley_de_la_demanda" -- por
  -- eso el unique es (module_id, tag), no (classroom_id, tag).)
  UNIQUE (module_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_classroom_concepts_module_id ON classroom_concepts(module_id);
CREATE INDEX IF NOT EXISTS idx_classroom_concepts_classroom_id ON classroom_concepts(classroom_id);

ALTER TABLE classroom_concepts ENABLE ROW LEVEL SECURITY;

-- Mismo patron que lesson_questions (017/033): estudiantes inscritos
-- pueden LEER la taxonomia de su clase (la necesitan solo indirectamente,
-- vive server-side en el prompt, pero /api/generate-questions corre con
-- la sesion del propio estudiante cuando el cache esta bajo, asi que
-- necesita poder INSERTAR conceptos nuevos la primera vez que un modulo
-- se genera a partir de una apertura de leccion del estudiante).
CREATE POLICY "students_read_classroom_concepts"
  ON classroom_concepts FOR SELECT
  USING (
    classroom_id IN (
      SELECT ce.classroom_id FROM class_enrollments ce WHERE ce.student_id = auth.uid()
    )
  );

CREATE POLICY "students_insert_classroom_concepts"
  ON classroom_concepts FOR INSERT
  WITH CHECK (
    module_id IN (
      SELECT cm.id FROM content_modules cm
      JOIN class_enrollments ce ON ce.classroom_id = cm.classroom_id
      WHERE ce.student_id = auth.uid()
    )
  );

-- Profesores duenos de la clase: lectura, insercion (generacion bulk /
-- objetivos de aprendizaje) y ademas UPDATE/DELETE, porque la migracion de
-- saneamiento (script manual, scripts/sanitize-concept-tags.mjs) propone
-- fusionar tags duplicados por similitud de embedding y el profesor es
-- quien decide aplicar esos merges.
CREATE POLICY "teachers_read_classroom_concepts"
  ON classroom_concepts FOR SELECT
  USING (classroom_id IN (SELECT c.id FROM classrooms c WHERE c.teacher_id = auth.uid()));

CREATE POLICY "teachers_insert_classroom_concepts"
  ON classroom_concepts FOR INSERT
  WITH CHECK (classroom_id IN (SELECT c.id FROM classrooms c WHERE c.teacher_id = auth.uid()));

CREATE POLICY "teachers_update_classroom_concepts"
  ON classroom_concepts FOR UPDATE
  USING (classroom_id IN (SELECT c.id FROM classrooms c WHERE c.teacher_id = auth.uid()));

CREATE POLICY "teachers_delete_classroom_concepts"
  ON classroom_concepts FOR DELETE
  USING (classroom_id IN (SELECT c.id FROM classrooms c WHERE c.teacher_id = auth.uid()));
