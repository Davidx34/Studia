-- Dos cambios de seguridad (revision del 2026-10-10):
--
-- 1) apply_pending_registration(p_email) dejaba reclamar la invitacion de CUALQUIER correo. Era SECURITY
--    DEFINER y solo comprobaba que existiera una invitacion pendiente para p_email; no que p_email fuera el
--    correo de quien llama. Verificado en produccion (simulacion en transaccion revertida): un estudiante
--    llamaba apply_pending_registration('correo-de-un-profesor-invitado') y su rol pasaba a 'teacher'. El
--    trigger profiles_role_guard (migracion 051) no lo impedia: dentro de una funcion SECURITY DEFINER
--    current_user es el dueño. Ahora el correo debe ser el de la cuenta autenticada.
--
-- 2) teaching_materials.processing_started_at: marca de cuando empezo el ultimo procesamiento. Permite no
--    reprocesar un material que ya se esta procesando ni repetirlo en bucle (cada procesamiento de un PDF
--    gasta cuota de Gemini y de pago en OpenRouter).

CREATE OR REPLACE FUNCTION public.apply_pending_registration(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_account_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  -- Solo se puede reclamar la invitacion del correo de la PROPIA cuenta.
  SELECT lower(trim(u.email)) INTO v_account_email FROM auth.users u WHERE u.id = auth.uid();
  IF v_account_email IS NULL OR v_account_email <> lower(trim(p_email)) THEN
    RETURN NULL;
  END IF;

  SELECT role INTO v_role
  FROM pending_registrations
  WHERE lower(email) = v_account_email AND used_at IS NULL;

  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE profiles SET role = v_role WHERE id = auth.uid();
  UPDATE pending_registrations SET used_at = now() WHERE lower(email) = v_account_email;

  RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pending_registration(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_pending_registration(text) TO authenticated;

ALTER TABLE public.teaching_materials
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

COMMENT ON COLUMN public.teaching_materials.processing_started_at IS
  'Cuando empezo el ultimo procesamiento. Evita reprocesar un material que ya se procesa y repetirlo en bucle (cuesta cuota de IA).';

NOTIFY pgrst, 'reload schema';
