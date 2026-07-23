-- Migration 034: registro por invitacion + funciones para el panel de desarrollador
-- Fase 11 · Mejora Estructural 3/4 · Stud.ia
--
-- pending_registrations guarda que emails puede registrarse y con que rol.
-- La tabla NO tiene policies de RLS (queda bloqueada a acceso directo desde
-- el cliente); todo el acceso pasa por funciones SECURITY DEFINER de abajo,
-- que se llaman desde rutas server-side ya autenticadas/autorizadas (el
-- checkeo de password del panel dev vive en el servidor via env var, nunca
-- en una tabla ni en el cliente).

CREATE TABLE IF NOT EXISTS pending_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('student', 'teacher')),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pending_registrations_email ON pending_registrations(lower(email));

ALTER TABLE pending_registrations ENABLE ROW LEVEL SECURITY;
-- Sin policies a proposito: nadie puede leer/escribir esta tabla directo
-- desde supabase-js con la anon key. Solo las funciones de abajo (definer).

-- ============================================================
-- Usadas por el flujo de signup (pre-auth y post-auth)
-- ============================================================

-- Se llama ANTES de crear la cuenta: bloquea el signup si el email no esta
-- pre-registrado. Devuelve el rol si es valido, o NULL si no.
CREATE OR REPLACE FUNCTION check_pending_registration(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM pending_registrations
  WHERE lower(email) = lower(trim(p_email)) AND used_at IS NULL;
  RETURN v_role;
END;
$$;

GRANT EXECUTE ON FUNCTION check_pending_registration(text) TO anon, authenticated;

-- Se llama DESPUES de crear la cuenta (con sesion activa): asigna el rol
-- pre-registrado al perfil recien creado y marca la invitacion como usada.
CREATE OR REPLACE FUNCTION apply_pending_registration(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM pending_registrations
  WHERE lower(email) = lower(trim(p_email)) AND used_at IS NULL;

  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE profiles SET role = v_role WHERE id = auth.uid();
  UPDATE pending_registrations SET used_at = now() WHERE lower(email) = lower(trim(p_email));

  RETURN v_role;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_pending_registration(text) TO authenticated;

-- ============================================================
-- Usadas por el panel de desarrollador (/dev/dashboard)
-- ============================================================
-- El panel dev NO usa auth de Supabase (es una sesion firmada aparte,
-- verificada server-side contra DEV_PASSWORD). Estas funciones se llaman
-- solo desde rutas API que ya validaron esa sesion antes de invocarlas.

CREATE OR REPLACE FUNCTION dev_list_pending_registrations()
RETURNS SETOF pending_registrations
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM pending_registrations ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION dev_add_pending_registration(p_email text, p_role text)
RETURNS pending_registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row pending_registrations;
BEGIN
  INSERT INTO pending_registrations (email, role)
  VALUES (lower(trim(p_email)), p_role)
  ON CONFLICT (email) DO UPDATE SET role = excluded.role, used_at = NULL
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION dev_delete_pending_registration(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM pending_registrations WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION dev_list_recent_profiles(p_limit integer DEFAULT 30)
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles ORDER BY created_at DESC LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION dev_analytics_summary()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_students', (SELECT count(*) FROM profiles WHERE role = 'student'),
    'total_teachers', (SELECT count(*) FROM profiles WHERE role = 'teacher'),
    'total_classrooms', (SELECT count(*) FROM classrooms),
    'total_modules', (SELECT count(*) FROM content_modules),
    'total_lesson_questions', (SELECT count(*) FROM lesson_questions),
    'signups_last_7_days', (SELECT count(*) FROM profiles WHERE created_at > now() - interval '7 days'),
    'pending_registrations_unused', (SELECT count(*) FROM pending_registrations WHERE used_at IS NULL),
    'active_classrooms', (SELECT count(*) FROM classrooms WHERE is_active = true)
  );
$$;

GRANT EXECUTE ON FUNCTION dev_list_pending_registrations() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION dev_add_pending_registration(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION dev_delete_pending_registration(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION dev_list_recent_profiles(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION dev_analytics_summary() TO anon, authenticated;
