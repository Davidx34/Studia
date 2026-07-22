-- Migration 033: permisos de escritura para profesores en lesson_questions
-- Fase 11 · Mejora Estructural 2 · Stud.ia
--
-- El flujo nuevo de "objetivos de aprendizaje" deja que el profesor dispare
-- /api/regenerate-module-questions (o el server action equivalente) desde su
-- propia sesion para REEMPLAZAR el pool completo (activo + backup) de un
-- modulo que le pertenece. Hasta ahora lesson_questions solo tenia INSERT
-- para estudiantes (cache incremental de generate-questions) y SELECT para
-- profesores; faltaban INSERT/DELETE para el profesor dueno del modulo.

CREATE POLICY "teachers_insert_lesson_questions"
  ON lesson_questions FOR INSERT
  WITH CHECK (
    module_id IN (
      SELECT cm.id FROM content_modules cm WHERE cm.teacher_id = auth.uid()
    )
  );

CREATE POLICY "teachers_delete_lesson_questions"
  ON lesson_questions FOR DELETE
  USING (
    module_id IN (
      SELECT cm.id FROM content_modules cm WHERE cm.teacher_id = auth.uid()
    )
  );
