-- 084: cierre de la leccion EN EL SERVIDOR (fase 2a del plan docs/PLAN_CALIFICACION_EN_SERVIDOR.md, paso "expandir").
--
-- Problema: el progreso (student_progress: estado, puntaje, intentos, tiempo) lo escribe el NAVEGADOR con una politica ALL sobre la fila propia. Aunque cada respuesta ya se califique en el
-- servidor (lesson_attempt_answers), un estudiante puede escribir "completado, 100" sin haber respondido nada, y de ese dato leen los logros, las monedas y los reportes del profesor.
--
-- Solucion: finish_lesson(attempt, estudiante, segundos) calcula el puntaje DESDE las respuestas verificadas del intento y escribe student_progress. Solo la ejecuta el servidor (service_role):
-- la ruta POST /api/lesson/finish comprueba la sesion y pasa el id del estudiante, y la funcion vuelve a comprobar que el intento es suyo.
--
--   - El intento debe ser del estudiante y tener TODAS las preguntas servidas cerradas (acertadas o con los intentos agotados). Si falta alguna, no se cierra.
--   - El puntaje es acertadas / servidas por el servidor. Las preguntas que el servidor aun no califica (minijuegos no migrados) no entran en el intento y no cuentan.
--   - Es idempotente: cerrar dos veces devuelve el mismo resultado sin sumar otro intento.
--   - El tiempo que manda el navegador se acota a lo que de verdad paso desde que se abrio el intento y a 2 horas.
--   - Se bloquea la fila del intento (FOR UPDATE): dos cierres simultaneos no suman dos veces.
--
-- Esta migracion NO cierra la politica ALL de student_progress: eso rompe las lecciones que el servidor todavia no califica (juegos no migrados, modo sin SERVER_GRADING). Se hace despues
-- ("contraer"), cuando ya no quede ninguna escritura directa. Aditiva: si la funcion no existe (migracion sin aplicar), la aplicacion sigue escribiendo el progreso como antes.
--
-- Ademas: generated_questions la podia leer CUALQUIER usuario autenticado de CUALQUIER clase (y puede traer las respuestas). Tiene 0 filas y nadie la usa desde el navegador; se acota al
-- profesor dueño de la clase.

ALTER TABLE public.lesson_attempts
  ADD COLUMN IF NOT EXISTS score_percent  integer CHECK (score_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS correct_count  integer CHECK (correct_count >= 0),
  ADD COLUMN IF NOT EXISTS graded_count   integer CHECK (graded_count >= 0),
  ADD COLUMN IF NOT EXISTS time_seconds   integer CHECK (time_seconds >= 0);

CREATE OR REPLACE FUNCTION public.finish_lesson(p_attempt_id uuid, p_student_id uuid, p_client_seconds integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a          public.lesson_attempts%ROWTYPE;
  v_total    integer;
  v_answered integer;
  v_correct  integer;
  v_score    integer;
  v_elapsed  integer;
BEGIN
  IF p_attempt_id IS NULL OR p_student_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  -- Bloquea el intento: dos cierres a la vez se serializan.
  SELECT * INTO a FROM public.lesson_attempts WHERE id = p_attempt_id AND student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Idempotente: ya cerrado -> el mismo resultado, sin sumar otro intento.
  IF a.status = 'finished' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'score', a.score_percent, 'correct', a.correct_count, 'total', a.graded_count, 'seconds', a.time_seconds);
  END IF;

  v_total := coalesce(array_length(a.question_ids, 1), 0);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_grade');
  END IF;

  SELECT count(*) FILTER (WHERE final), count(*) FILTER (WHERE final AND correct)
    INTO v_answered, v_correct
  FROM public.lesson_attempt_answers
  WHERE attempt_id = a.id AND question_id = ANY (a.question_ids);

  -- Todas las preguntas servidas deben estar cerradas: no se puede "completar" una leccion a medias.
  IF v_answered < v_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unanswered', 'answered', v_answered, 'total', v_total);
  END IF;

  v_score   := round(100.0 * v_correct / v_total);
  -- Lo que dice el navegador no puede pasar de lo que de verdad transcurrio desde que se abrio el intento, ni de 2 horas.
  v_elapsed := greatest(0, least(coalesce(p_client_seconds, 0), 7200, extract(epoch FROM (now() - a.started_at))::integer));

  INSERT INTO public.student_progress
    (student_id, module_id, status, completion_percentage, score, best_score, attempts, time_spent_seconds, started_at, completed_at, last_attempt_at)
  VALUES
    (a.student_id, a.module_id, 'completed', 100, v_score, v_score, 1, v_elapsed, a.started_at, now(), now())
  ON CONFLICT (student_id, module_id) DO UPDATE SET
    status                = 'completed',
    completion_percentage = 100,
    score                 = EXCLUDED.score,
    best_score            = greatest(coalesce(public.student_progress.best_score, 0), EXCLUDED.score),
    attempts              = coalesce(public.student_progress.attempts, 0) + 1,
    time_spent_seconds    = coalesce(public.student_progress.time_spent_seconds, 0) + EXCLUDED.time_spent_seconds,
    started_at            = coalesce(public.student_progress.started_at, EXCLUDED.started_at),
    completed_at          = now(),
    last_attempt_at       = now();

  UPDATE public.lesson_attempts
     SET status = 'finished', finished_at = now(), score_percent = v_score, correct_count = v_correct, graded_count = v_total, time_seconds = v_elapsed
   WHERE id = a.id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'score', v_score, 'correct', v_correct, 'total', v_total, 'seconds', v_elapsed);
END;
$$;

-- Solo el servidor: el estudiante no puede llamarla (ni siquiera con su propio intento) saltandose la ruta.
REVOKE ALL ON FUNCTION public.finish_lesson(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_lesson(uuid, uuid, integer) TO service_role;

-- generated_questions: de "cualquier autenticado" al profesor dueño de la clase del modulo.
DROP POLICY IF EXISTS "Autenticados leen preguntas" ON public.generated_questions;
CREATE POLICY "Profesor lee preguntas generadas de su clase"
  ON public.generated_questions FOR SELECT
  USING (
    module_id IN (
      SELECT cm.id
      FROM public.content_modules cm
      JOIN public.classrooms c ON c.id = cm.classroom_id
      WHERE c.teacher_id = auth.uid()
    )
  );
