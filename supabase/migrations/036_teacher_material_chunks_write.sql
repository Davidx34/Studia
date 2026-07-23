-- Migration 036: permisos de escritura para profesores en material_chunks
-- Fase 11 · Sesion K · Stud.ia
--
-- material_chunks solo tenia policies de SELECT (el pipeline de archivos
-- corre en la edge function process-material con service_role, que bypasea
-- RLS). Los nuevos pipelines de link/YouTube (Sesion K) corren in-process en
-- server actions con la sesion propia del profesor, asi que necesitan poder
-- insertar/borrar directamente. Esto tambien arregla un bug latente: el
-- borrado de chunks viejos en reprocessMaterial() ya usaba la sesion del
-- profesor (no service role) y fallaba en silencio por falta de policy.

CREATE POLICY "teachers_insert_material_chunks"
  ON material_chunks FOR INSERT
  WITH CHECK (
    material_id IN (
      SELECT tm.id FROM teaching_materials tm WHERE tm.teacher_id = auth.uid()
    )
  );

CREATE POLICY "teachers_delete_material_chunks"
  ON material_chunks FOR DELETE
  USING (
    material_id IN (
      SELECT tm.id FROM teaching_materials tm WHERE tm.teacher_id = auth.uid()
    )
  );
