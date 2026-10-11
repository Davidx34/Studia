-- El registro es "por invitacion" (solo correos que el administrador agrego en /dev), pero esa regla SOLO existia en
-- el navegador: la pagina de registro consultaba check_pending_registration antes de llamar a signUp. Quien llamara
-- directamente al servicio de Auth con la llave anon (publica) creaba una cuenta sin invitacion, y la propia funcion
-- check_pending_registration, abierta a anon, servia para averiguar que correos estan invitados y con que rol.
--
-- Ahora la regla vive donde no se puede saltar:
--   1. handle_new_user (disparador del alta en auth.users) rechaza el alta si el correo no tiene una invitacion sin
--      usar. Con la excepcion, Auth devuelve error y no se crea ni el usuario ni el perfil.
--   2. check_pending_registration deja de ser invocable por anon/authenticated (solo service_role). La pagina de
--      registro ya no la consulta.
--
-- No cambia nada para quien ya tiene cuenta. La asignacion del rol sigue en apply_pending_registration (que exige que
-- la invitacion sea del correo de quien llama).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pending_registrations pr
    WHERE lower(pr.email) = lower(trim(NEW.email))
      AND pr.used_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Registro no autorizado: este correo no tiene una invitacion pendiente.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.profiles (id, username, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.check_pending_registration(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_pending_registration(text) TO service_role;
