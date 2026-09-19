-- El bloqueo de generacion como funciones SQL con privilegios propios.
--
-- Por que existe: /api/generate-questions corre con la sesion del ESTUDIANTE, y
-- acquireGenerationLock hacia un UPDATE sobre content_modules desde esa sesion.
-- Pero en content_modules un estudiante solo puede LEER: la unica politica de
-- escritura es "Teachers manejan su contenido" (teacher_id = auth.uid()).
-- Con RLS, un UPDATE que no puede ver la fila NO da error: afecta 0 filas. El
-- codigo leia "0 filas" como "otra generacion en curso" (busy), asi que un
-- estudiante NUNCA podia tomar el bloqueo: la ruta respondia 202 sin preguntas
-- indefinidamente y la pantalla mostraba "No pude preparar esta leccion".
--
-- Verificado el 2026-09-19 simulando al estudiante en la base: ve el modulo (1
-- fila) pero puede actualizar 0 filas.
--
-- Esto estuvo oculto dos veces: primero por la columna ausente (migracion 046) y
-- luego porque la verificacion se hizo con la llave de administrador, que se salta
-- el RLS.
--
-- Solucion: dos funciones SECURITY DEFINER (corren como su dueño, no como el
-- llamador) que hacen la escritura, pero SOLO si quien llama puede de verdad usar
-- ese modulo: su profesor, o un estudiante inscrito en su clase. Sin esa
-- comprobacion serian una puerta para bloquear la generacion de cualquier modulo.
--
-- La toma es UN solo UPDATE condicional: atomica, sin carrera entre dos estudiantes.

CREATE OR REPLACE FUNCTION public.acquire_generation_lock(p_module_id uuid, p_ttl_seconds integer DEFAULT 180)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
  v_ttl  integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 180), 60), 600);  -- acotado: el llamador no puede robar el bloqueo con ttl=0
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'forbidden';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.content_modules m
    WHERE m.id = p_module_id
      AND (
        m.teacher_id = auth.uid()
        OR m.classroom_id IN (SELECT ce.classroom_id FROM public.class_enrollments ce WHERE ce.student_id = auth.uid())
      )
  ) THEN
    RETURN 'forbidden';
  END IF;

  UPDATE public.content_modules
     SET is_generating = true,
         generation_started_at = now()
   WHERE id = p_module_id
     AND (
       is_generating = false
       OR generation_started_at IS NULL
       OR generation_started_at < now() - make_interval(secs => v_ttl)
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN CASE WHEN v_rows > 0 THEN 'acquired' ELSE 'busy' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_generation_lock(p_module_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.content_modules m
    WHERE m.id = p_module_id
      AND (
        m.teacher_id = auth.uid()
        OR m.classroom_id IN (SELECT ce.classroom_id FROM public.class_enrollments ce WHERE ce.student_id = auth.uid())
      )
  ) THEN
    RETURN;
  END IF;

  UPDATE public.content_modules
     SET is_generating = false,
         generation_started_at = NULL
   WHERE id = p_module_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_generation_lock(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_generation_lock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_generation_lock(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_generation_lock(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
