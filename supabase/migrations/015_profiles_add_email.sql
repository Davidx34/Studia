-- Migration 015: add email column to profiles + backfill + sync trigger
-- Fase 11.B · Stud.ia
--
-- El brief asumia que public.profiles tenia columna email, pero no era el caso:
-- el email vivia solo en auth.users.email. Esta migracion lo denormaliza a
-- public.profiles.email para que el server action inviteStudents (y otros
-- flujos como la tabla de progreso de 11.E) puedan hacer lookup directo.
--
-- Pasos:
--   1. ADD COLUMN email TEXT (nullable inicialmente para permitir backfill)
--   2. UPDATE backfill desde auth.users (10 perfiles existentes)
--   3. ADD CONSTRAINT UNIQUE (despues del backfill, para no romper)
--   4. CREATE OR REPLACE handle_new_user() incluyendo email + SET search_path
--      explicito (de paso resuelve el WARN del advisor de seguridad)
--
-- IMPORTANTE: aditiva. NO toca filas (excepto backfill que solo rellena la
-- columna nueva). NO modifica el trigger on_auth_user_created (sigue
-- apuntando a la misma funcion handle_new_user, que es la que reemplazamos).

-- 1. Columna nueva, nullable
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Backfill desde auth.users
UPDATE public.profiles p
SET email = au.email
FROM auth.users au
WHERE p.id = au.id
  AND p.email IS NULL;

-- 3. UNIQUE constraint despues del backfill (idempotente con DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_email_unique'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_email_unique UNIQUE (email);
  END IF;
END $$;

-- 4. Reemplazar handle_new_user para incluir email + endurecer search_path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );
  RETURN NEW;
END;
$$;
