-- 094: indices para 8 claves foraneas sin indice que cubra (aviso «unindexed_foreign_keys» del linter de Supabase).
--
-- Sin indice, borrar o actualizar la fila referenciada obliga a recorrer toda la tabla hija, y los filtros por esa columna no pueden usar indice. Hoy las tablas son pequeñas (la mayor tiene ≈9 filas), asi
-- que el efecto actual es nulo; se crean ahora porque son tablas nuevas que van a crecer con cada plan, examen y laboratorio.
--
-- Verificado en produccion (solo lectura, 2026-11-06): ninguno de estos indices existe; las tablas miden entre 0 bytes y 24 kB, asi que CREATE INDEX es instantaneo y no bloquea de forma apreciable.
-- Aditivo: no cambia datos ni politicas.
--
-- Para deshacer: DROP INDEX de cada uno.

CREATE INDEX IF NOT EXISTS idx_blueprint_module_links_blueprint ON public.blueprint_module_links (blueprint_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_blueprint ON public.exam_attempts (blueprint_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_exam_questions_blueprint ON public.exam_questions (blueprint_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_exam_questions_reviewed_by ON public.exam_questions (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_blueprint ON public.exam_sessions (blueprint_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_lab_attempts_student ON public.lab_attempts (student_id);
CREATE INDEX IF NOT EXISTS idx_labs_source_material ON public.labs (source_material_id);
CREATE INDEX IF NOT EXISTS idx_labs_teacher ON public.labs (teacher_id);
