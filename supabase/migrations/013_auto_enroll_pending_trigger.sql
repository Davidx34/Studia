-- Migration 013: auto_enroll_pending function + trigger
-- Fase 11.A · Stud.ia
--
-- Función trigger que se dispara cuando se crea un perfil nuevo (signup).
-- Si hay pending_enrollments matcheando el email del nuevo usuario,
-- los promueve a class_enrollments y borra las pendientes consumidas.
--
-- Por qué auth.users en lugar de usar NEW.email:
--   La tabla profiles puede no tener columna email visible o la consideramos
--   fuente de verdad en auth. Leemos auth.users.email por NEW.id (que es el UUID
--   compartido entre auth.users y profiles).
--
-- Matching case-insensitive con LOWER(...) en ambos lados.
-- ON CONFLICT DO NOTHING: por si hubiera ya una enrollment manual.
--
-- SECURITY DEFINER + search_path explícito (public, auth) para poder
-- leer auth.users sin requerir grants explícitos al rol authenticated.
--
-- DROP TRIGGER IF EXISTS hace la migración idempotente.

CREATE OR REPLACE FUNCTION public.auto_enroll_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.id;

  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.class_enrollments (classroom_id, student_id, teacher_id)
  SELECT pe.classroom_id, NEW.id, pe.teacher_id
  FROM public.pending_enrollments pe
  WHERE LOWER(pe.email) = LOWER(v_email)
  ON CONFLICT DO NOTHING;

  DELETE FROM public.pending_enrollments
  WHERE LOWER(email) = LOWER(v_email);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_auto_enroll ON public.profiles;

CREATE TRIGGER on_profile_created_auto_enroll
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_enroll_pending();
