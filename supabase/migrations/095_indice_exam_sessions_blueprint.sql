-- 095: corrige la 094 en `exam_sessions`.
--
-- La 094 usaba `CREATE INDEX IF NOT EXISTS idx_exam_sessions_blueprint ... (blueprint_id, classroom_id)`, pero ya existia (migracion 089) un indice con ESE nombre sobre (blueprint_id) solo; por el
-- IF NOT EXISTS no se creo el compuesto y el aviso `unindexed_foreign_keys` sigue listando `exam_sessions_blueprint_fk` (clave foranea (blueprint_id, classroom_id)). Los otros 7 indices de la 094
-- si se crearon (el aviso ya no los lista). Leccion: comprobar la DEFINICION del indice, no solo su nombre (la prueba de la 094 contaba nombres).
--
-- Se crea el indice compuesto con un nombre nuevo. Tabla pequeña: instantaneo. Aditivo.
-- Para deshacer: DROP INDEX public.idx_exam_sessions_blueprint_classroom;

CREATE INDEX IF NOT EXISTS idx_exam_sessions_blueprint_classroom ON public.exam_sessions (blueprint_id, classroom_id);
