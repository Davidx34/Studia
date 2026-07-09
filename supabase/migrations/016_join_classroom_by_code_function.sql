-- Migration 016: join_classroom_by_code function
-- Fase 11 · Sesión #2 · Stud.ia
--
-- RPC para que un estudiante se una a una clase ingresando su join_code.
-- Necesaria porque la policy de SELECT en classrooms solo permite ver
-- clases en las que el estudiante ya está inscrito (no puede resolver
-- join_code -> classroom_id por sí mismo). SECURITY DEFINER + búsqueda
-- explícita por join_code resuelve esto sin abrir una policy pública
-- de lectura sobre toda la tabla classrooms.
--
-- ON CONFLICT DO NOTHING: idempotente si el estudiante ya estaba inscrito.
-- DROP FUNCTION IF EXISTS hace la migración idempotente en reruns.

DROP FUNCTION IF EXISTS public.join_classroom_by_code(text);

CREATE OR REPLACE FUNCTION public.join_classroom_by_code(p_join_code TEXT)
RETURNS TABLE (classroom_id UUID, classroom_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_id UUID;
  v_classroom_name TEXT;
  v_teacher_id UUID;
BEGIN
  SELECT id, name, teacher_id
  INTO v_classroom_id, v_classroom_name, v_teacher_id
  FROM public.classrooms
  WHERE join_code = UPPER(TRIM(p_join_code))
    AND is_active = true;

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION 'Código de clase inválido o clase inactiva.';
  END IF;

  INSERT INTO public.class_enrollments (classroom_id, student_id, teacher_id)
  VALUES (v_classroom_id, auth.uid(), v_teacher_id)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT v_classroom_id, v_classroom_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_classroom_by_code(text) TO authenticated;
