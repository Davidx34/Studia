-- 086: "contraer" (fase 2b de docs/PLAN_CALIFICACION_EN_SERVIDOR.md, docs/CIERRE_DE_LECCION.md). Cierra lo que un estudiante puede ESCRIBIR y LEER con la llave publica en tres tablas.
--
-- Problema (verificado en produccion el 2026-11-01): con la llave publica del navegador un estudiante puede
--   1. escribir su propio progreso: la politica ALL "Students manejan su progreso" de student_progress le deja insertar "completado, 100" sin haber respondido nada, y de ese dato leen
--      los logros, las monedas y los reportes del profesor;
--   2. insertar sus propios intentos en question_attempts (y falsear lo que ve el profesor y la practica);
--   3. LEER todas las claves del banco de preguntas de sus clases (lesson_questions: ok, answers, keywords, game_data), es decir, ver las respuestas antes de contestar;
--   4. INSERTAR preguntas en el banco de su clase (students_insert_lesson_questions), que se servirian despues a sus companeros.
-- Ademas, anon y authenticated tienen TODOS los privilegios de tabla (incluido TRUNCATE) y solo las politicas de fila los frenan.
--
-- Solucion: el SERVIDOR (llave de servicio) escribe el progreso (finish_lesson y markLessonInProgress), registra los intentos (/api/lesson/answer) y lee y escribe el banco de preguntas
-- (/api/generate-questions, solo para quien ve el modulo). Esta migracion quita al estudiante esas escrituras y esa lectura:
--   - student_progress: el estudiante solo LEE su fila. El profesor sigue viendo la de sus estudiantes (politica intacta).
--   - question_attempts: el estudiante solo LEE los suyos; el profesor, los de su clase (politicas intactas).
--   - lesson_questions: se quitan las politicas de estudiante (leer e insertar). El profesor conserva las suyas (leer, insertar, actualizar, borrar sus preguntas).
--   - anon pierde todo en las tres tablas; authenticated pierde TRUNCATE, REFERENCES y TRIGGER, y las escrituras de student_progress y question_attempts.
-- No toca las funciones SECURITY DEFINER que escriben estas tablas (finish_lesson, _evaluate_achievements_impl): siguen funcionando.
--
-- ORDEN DE DESPLIEGUE (si no se respeta, algo deja de registrarse):
--   1. el codigo del PR "contraer, parte 1" ya desplegado (el servidor marca "en progreso" y maneja el banco);
--   2. SERVER_GRADING=on (ya lo esta) y SERVER_GRADING_GAMES=on tras probar los 8 minijuegos: sin el, los minijuegos se califican en el navegador y su intento se registra desde el
--      navegador, camino que esta migracion cierra (la leccion sigue cerrandose y puntuando en el servidor, pero esos intentos de juego dejan de quedar en question_attempts).
-- Re-ejecutable: DROP POLICY IF EXISTS y REVOKE son idempotentes.

-- ───────────────────────────── student_progress ─────────────────────────────

DROP POLICY IF EXISTS "Students manejan su progreso" ON public.student_progress;
DROP POLICY IF EXISTS students_read_own_progress ON public.student_progress;
CREATE POLICY students_read_own_progress ON public.student_progress
  FOR SELECT USING (student_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.student_progress FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.student_progress FROM authenticated;

-- ───────────────────────────── question_attempts ─────────────────────────────

DROP POLICY IF EXISTS students_insert_own_question_attempts ON public.question_attempts;

REVOKE ALL ON TABLE public.question_attempts FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.question_attempts FROM authenticated;

-- ───────────────────────────── lesson_questions ─────────────────────────────
-- El profesor escribe con su sesion (sus politicas se mantienen), asi que authenticated conserva SELECT/INSERT/UPDATE/DELETE; sin la politica de estudiante, un estudiante no ve ni inserta filas.

DROP POLICY IF EXISTS students_read_lesson_questions ON public.lesson_questions;
DROP POLICY IF EXISTS students_insert_lesson_questions ON public.lesson_questions;

REVOKE ALL ON TABLE public.lesson_questions FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.lesson_questions FROM authenticated;

COMMENT ON TABLE public.student_progress IS 'Progreso por estudiante y modulo. El estudiante solo LEE su fila; la escribe el servidor (finish_lesson y markLessonInProgress).';
COMMENT ON TABLE public.question_attempts IS 'Intentos por pregunta. El estudiante solo LEE los suyos; los registra el servidor al calificar (/api/lesson/answer).';
