-- El navegador deja de poder escribir la economia (XP, nivel, monedas, corazones, racha) ni su rol/identidad.
--
-- Va DESPUES de la 052 y de desplegar el codigo que usa award_xp_*: antes de eso el cliente todavia escribia
-- total_xp directamente y este REVOKE lo habria dejado sin XP durante el cambio.
--
-- Se retira el UPDATE de toda la tabla y se devuelve SOLO sobre columnas de preferencias. Las funciones
-- SECURITY DEFINER (rachas, logros, corazones, XP) siguen escribiendo todo. Antes: cualquier estudiante podia
-- hacer PATCH /profiles con {"coins": 999999, "total_xp": 999999}.

REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (username, full_name, avatar_url, gemini_preferences, tonito_state, timezone, last_login_at, updated_at)
  ON public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
