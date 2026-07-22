-- Migration 031: permisos de escritura para material_chunks_processed
-- Fase 11 · Sesion I · Fix 3 · Stud.ia
--
-- El procesamiento se dispara desde el propio estudiante/profesor
-- autenticado (via /api/process-material-chunks, usando su sesion, no
-- service role), asi que hace falta permitir INSERT/UPDATE ademas del
-- SELECT ya creado en la migracion 030.

CREATE POLICY "students_write_processed_chunks"
  ON material_chunks_processed FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teaching_materials tm
      JOIN class_enrollments ce ON ce.classroom_id = tm.classroom_id
      WHERE tm.id = material_chunks_processed.material_id AND ce.student_id = auth.uid()
    )
  );

CREATE POLICY "students_update_processed_chunks"
  ON material_chunks_processed FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM teaching_materials tm
      JOIN class_enrollments ce ON ce.classroom_id = tm.classroom_id
      WHERE tm.id = material_chunks_processed.material_id AND ce.student_id = auth.uid()
    )
  );

CREATE POLICY "teachers_write_own_processed_chunks"
  ON material_chunks_processed FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teaching_materials tm
      WHERE tm.id = material_chunks_processed.material_id AND tm.teacher_id = auth.uid()
    )
  );

CREATE POLICY "teachers_update_own_processed_chunks"
  ON material_chunks_processed FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM teaching_materials tm
      WHERE tm.id = material_chunks_processed.material_id AND tm.teacher_id = auth.uid()
    )
  );
