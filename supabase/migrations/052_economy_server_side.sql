-- La economia del juego (XP, nivel, monedas, corazones, racha) deja de escribirla el navegador.
--
-- Por que existe: la revision de seguridad del 2026-10-10 mostro que el cliente escribia VALORES ABSOLUTOS
-- en profiles (total_xp = total_xp + X). Como `authenticated` tenia UPDATE sobre toda la tabla y la politica
-- solo comprobaba auth.uid() = id, cualquier estudiante podia hacer PATCH /profiles con {"coins": 999999,
-- "total_xp": 999999} desde la consola del navegador.
--
-- Que hace:
--  1. xp_ledger: libro de XP otorgado. La UNIQUE (user_id, source, ref) hace cada premio idempotente y NO
--     depende de filas que el estudiante pueda editar (borrar y reinsertar su progreso no da XP de nuevo).
--  2. Tres funciones SECURITY DEFINER calculan el XP en el SERVIDOR (el cliente ya no manda cantidades):
--       award_xp_module        base_xp_reward del modulo, una vez por modulo
--       award_xp_remediation   25..50 segun el puntaje, una vez por modulo y dia
--       award_xp_plan_round    15..30, una vez por ronda de un plan creado por un PROFESOR
--  (El paso que retira el UPDATE de profiles al navegador va en la migracion 053, DESPUES de desplegar el codigo
--   que usa estas funciones: aplicarlo antes dejaria sin XP a quien termine una leccion durante el cambio.)
--
-- LIMITE HONESTO: esto acota el abuso, no lo elimina. El estudiante todavia puede marcar un modulo como
-- completado (student_progress lo escribe el navegador) y cobrar su XP UNA vez. Lo que ya no puede es dar-se
-- valores arbitrarios ni cobrar de nuevo. Cerrarlo del todo exige validar las respuestas en el servidor.

-- ---------------------------------------------------------------- 1. libro de XP
CREATE TABLE IF NOT EXISTS public.xp_ledger (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('module', 'remediation', 'plan_round')),
  ref        text NOT NULL,
  xp         integer NOT NULL CHECK (xp >= 0 AND xp <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, ref)
);

ALTER TABLE public.xp_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Estudiantes ven su propio libro de XP" ON public.xp_ledger;
CREATE POLICY "Estudiantes ven su propio libro de XP" ON public.xp_ledger FOR SELECT USING (user_id = auth.uid());
REVOKE ALL ON public.xp_ledger FROM anon, authenticated;
GRANT SELECT ON public.xp_ledger TO authenticated;

-- Los modulos ya completados antes de esta migracion ya cobraron su XP: se registran para que no se repita.
INSERT INTO public.xp_ledger (user_id, source, ref, xp)
SELECT sp.student_id, 'module', sp.module_id::text, LEAST(GREATEST(COALESCE(cm.base_xp_reward, 0), 0), 500)
FROM public.student_progress sp
JOIN public.content_modules cm ON cm.id = sp.module_id
WHERE sp.status = 'completed'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- 2. otorgar XP (interna)
CREATE OR REPLACE FUNCTION public._grant_xp(p_user uuid, p_source text, p_ref text, p_xp integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xp integer := LEAST(GREATEST(COALESCE(p_xp, 0), 0), 500);
  v_inserted bigint;
BEGIN
  INSERT INTO public.xp_ledger (user_id, source, ref, xp)
  VALUES (p_user, p_source, p_ref, v_xp)
  ON CONFLICT (user_id, source, ref) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN 0; -- ya cobrado
  END IF;

  UPDATE public.profiles
     SET total_xp = total_xp + v_xp,
         current_level = GREATEST(1, FLOOR(SQRT((total_xp + v_xp) / 50.0))::int)
   WHERE id = p_user;
  RETURN v_xp;
END;
$$;

REVOKE ALL ON FUNCTION public._grant_xp(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 3. las tres formas de ganar XP
CREATE OR REPLACE FUNCTION public.award_xp_module(p_module_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_xp integer;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;

  -- El modulo debe ser de una clase en la que el estudiante esta inscrito, y debe haberlo completado.
  SELECT cm.base_xp_reward INTO v_xp
  FROM public.content_modules cm
  JOIN public.class_enrollments ce ON ce.classroom_id = cm.classroom_id AND ce.student_id = v_uid
  JOIN public.student_progress sp ON sp.module_id = cm.id AND sp.student_id = v_uid AND sp.status = 'completed'
  WHERE cm.id = p_module_id;

  IF NOT FOUND THEN RETURN 0; END IF;
  RETURN public._grant_xp(v_uid, 'module', p_module_id::text, v_xp);
END;
$$;

CREATE OR REPLACE FUNCTION public.award_xp_remediation(p_remediation_id uuid, p_score_percent integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module uuid;
  v_pct integer := LEAST(GREATEST(COALESCE(p_score_percent, 0), 0), 100);
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;

  SELECT sr.module_id INTO v_module
  FROM public.student_remediations sr
  WHERE sr.id = p_remediation_id AND sr.student_id = v_uid;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Una vez por modulo y dia: el estudiante puede crear filas de repaso a voluntad, asi que el tope NO puede
  -- depender del id de la fila.
  RETURN public._grant_xp(v_uid, 'remediation', v_module::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
                          ROUND(25 + v_pct * 0.25)::int);
END;
$$;

CREATE OR REPLACE FUNCTION public.award_xp_plan_round(p_plan_id uuid, p_round integer, p_score_percent integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target integer;
  v_pct integer := LEAST(GREATEST(COALESCE(p_score_percent, 0), 0), 100);
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;

  -- El plan lo crea un profesor: su modules_target acota cuantas rondas dan XP.
  SELECT rp.modules_target INTO v_target
  FROM public.remediation_plans rp
  WHERE rp.id = p_plan_id AND rp.student_id = v_uid;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF p_round IS NULL OR p_round < 1 OR p_round > v_target THEN RETURN 0; END IF;

  RETURN public._grant_xp(v_uid, 'plan_round', p_plan_id::text || ':' || p_round::text, ROUND(15 + v_pct * 0.15)::int);
END;
$$;

REVOKE ALL ON FUNCTION public.award_xp_module(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.award_xp_remediation(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.award_xp_plan_round(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_xp_module(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.award_xp_remediation(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.award_xp_plan_round(uuid, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
