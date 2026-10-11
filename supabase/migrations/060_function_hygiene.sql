-- Higiene de funciones (avisos de seguridad del linter de Supabase, revision 2026-10-11).
--
-- 1) function_search_path_mutable (6 funciones): sin search_path fijo, quien llama puede anteponer su propio
--    esquema y hacer que un nombre sin calificar resuelva a otro objeto. Las 6 solo usan tablas de public y funciones
--    de pg_catalog (que siempre se busca primero), asi que fijarlo a public no cambia su comportamiento.
-- 2) anon_security_definer_function_executable: handle_new_user() y auto_enroll_pending() son funciones de TRIGGER
--    (alta de usuario / inscripcion pendiente). No tienen razon de ser invocables por /rest/v1/rpc. Los triggers
--    siguen funcionando: PostgreSQL comprueba EXECUTE al CREAR el trigger, no al dispararlo (verificado con un alta
--    de usuario en una transaccion revertida). Por prudencia se deja EXECUTE a supabase_auth_admin, el rol que hace
--    el alta en auth.users.
--
-- NO se tocan aqui: check_pending_registration (el registro por invitacion la usa sin sesion), las extensiones en
-- public (mover vector exige recrear columnas e indices: riesgo alto, beneficio bajo) ni la proteccion contra
-- contraseñas filtradas (es un ajuste del panel de Supabase Auth, no de SQL).

ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.calculate_xp(integer, integer, integer, integer, integer, integer, integer) SET search_path = public;
ALTER FUNCTION public.trigger_generate_map_on_material_complete() SET search_path = public;
ALTER FUNCTION public.get_class_concept_metrics(uuid) SET search_path = public;
ALTER FUNCTION public.get_student_metrics(uuid) SET search_path = public;
ALTER FUNCTION public.get_concept_student_matrix(uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_enroll_pending() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION public.auto_enroll_pending() TO supabase_auth_admin;
  END IF;
END $$;
