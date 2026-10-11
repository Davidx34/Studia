-- Las invitaciones de un profesor a un estudiante que YA tenia cuenta quedaban "pendientes" para siempre.
--
-- Causa: al invitar, inviteStudents busca el correo en profiles con la sesion del profesor, y la RLS solo le deja ver
-- los perfiles de estudiantes que YA estan inscritos en alguna clase suya. Un estudiante con cuenta pero sin clases no
-- aparece, asi que el correo iba a pending_enrollments; y el unico que convierte esas filas en inscripcion es el
-- disparador auto_enroll_pending, que solo se ejecuta cuando se CREA un perfil (el registro), nunca para una cuenta
-- que ya existe. Caso real: una invitacion del 2026-09-21 a una cuenta del 2026-05-16, aun pendiente.
--
-- Arreglo: esta funcion la llama el propio estudiante al abrir su inicio. Inscribe a quien llama en todas las clases que
-- lo tienen pendiente por su correo (el de su cuenta de Auth, no uno que pueda escribir) y borra esas invitaciones.
-- No expone nada de otras cuentas: solo actua sobre quien llama. Solo para cuentas de estudiante.

CREATE OR REPLACE FUNCTION public.claim_pending_enrollments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_email text;
  v_enrolled integer := 0;
BEGIN
  -- Dentro de SECURITY DEFINER current_user es el dueño: se identifica al llamador con auth.uid().
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'student') THEN
    RETURN 0;
  END IF;

  SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL OR v_email = '' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.class_enrollments (classroom_id, student_id, teacher_id)
  SELECT pe.classroom_id, auth.uid(), pe.teacher_id
  FROM public.pending_enrollments pe
  WHERE lower(trim(pe.email)) = v_email
  ON CONFLICT (classroom_id, student_id) DO NOTHING;
  GET DIAGNOSTICS v_enrolled = ROW_COUNT;

  DELETE FROM public.pending_enrollments WHERE lower(trim(email)) = v_email;

  RETURN v_enrolled;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_pending_enrollments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_enrollments() TO authenticated;
