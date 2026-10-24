-- La racha pasa a contar ESTUDIO, no visitas (decision del dueño del proyecto, 2026-10-24).
--
-- Antes: check_and_update_streak se llamaba al abrir cualquier pantalla del estudiante (layout), asi que la racha medía
-- "dias que abrio la app". Ahora se actualiza cuando el estudiante hace algo de aprendizaje:
--   - responde una pregunta (se inserta una fila en question_attempts: lecciones, repaso y minijuegos, tanto si las
--     escribe el navegador como el servidor con SERVER_GRADING), o
--   - repasa una flashcard (se inserta o actualiza student_card_state).
--
-- Un disparador en la base cubre TODOS esos caminos sin acoplar el codigo. Las reglas de la racha NO cambian (siguen en
-- _check_and_update_streak_impl: actividad hoy = nada que hacer, ayer = +1, hace 2 dias = dia de gracia, mas = escudo o
-- reiniciar en 1); solo cambia QUE la dispara. La funcion es idempotente dentro del dia: la 2.ª respuesta del dia solo lee.
--
-- Orden de despliegue: esta migracion NO rompe el codigo viejo (si el layout aun llama a la racha, solo cuenta de mas), asi
-- que puede aplicarse antes o despues del PR que quita esa llamada. Sin esta migracion, el codigo nuevo dejaria de
-- actualizar la racha: aplicarla justo despues de desplegar.

CREATE OR REPLACE FUNCTION public.touch_streak_on_study()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._check_and_update_streak_impl(NEW.student_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- La racha es un extra: un fallo aqui NUNCA debe impedir guardar la respuesta o el repaso.
  RAISE WARNING 'touch_streak_on_study: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Solo la ejecuta el disparador (corre con los permisos del dueño); nadie la llama por RPC.
REVOKE ALL ON FUNCTION public.touch_streak_on_study() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_question_attempts_streak ON public.question_attempts;
CREATE TRIGGER trg_question_attempts_streak
  AFTER INSERT ON public.question_attempts
  FOR EACH ROW EXECUTE FUNCTION public.touch_streak_on_study();

DROP TRIGGER IF EXISTS trg_student_card_state_streak ON public.student_card_state;
CREATE TRIGGER trg_student_card_state_streak
  AFTER INSERT OR UPDATE ON public.student_card_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_streak_on_study();
