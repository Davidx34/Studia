-- Se elimina POR COMPLETO el sistema de XP y niveles (decision del dueño del proyecto, 2026-10-12).
--
-- Se conservan: monedas, tienda, corazones, racha y los logros que no dependen de XP.
--
-- Orden de despliegue: el codigo que ya no usa XP se despliega ANTES de aplicar esta migracion (por eso es un PR
-- aparte del codigo): aplicarla primero haria fallar las paginas viejas que aun leen estas columnas.
--
-- Datos que se borran (verificados antes): 2 logros por "xp_total" y sus 4 registros de logro ganado (cascada),
-- 1 mision "earn_xp" y su registro, 2 filas de xp_ledger, total_xp/current_level de los perfiles, earned_xp de los
-- progresos, el recuento semanal de XP (tabla vacia, sin uso en la app).

-- 1. Logros y misiones cuyo criterio ERA el XP (las FK hacia user_achievements y user_missions son ON DELETE CASCADE).
DELETE FROM public.achievements WHERE criteria_type = 'xp_total';
DELETE FROM public.daily_missions WHERE mission_type = 'earn_xp';

-- 2. La evaluacion de logros deja de leer el XP y de entregarlo (las monedas se siguen entregando).
CREATE OR REPLACE FUNCTION public._evaluate_achievements_impl(p_user_id uuid)
RETURNS TABLE(achievement_id uuid, name text, rarity text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_profile public.profiles;
  v_total_completed integer;
  v_perfect_count integer;
  v_total_coins integer;
  v_total_time integer;
  v_ach record;
  v_already_has boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_total_completed
  FROM public.student_progress
  WHERE student_id = p_user_id AND status = 'completed';

  SELECT COUNT(*) INTO v_perfect_count
  FROM public.student_progress
  WHERE student_id = p_user_id AND status = 'completed' AND best_score = 100;

  SELECT COALESCE(SUM(earned_coins), 0) INTO v_total_coins
  FROM public.student_progress
  WHERE student_id = p_user_id;

  SELECT COALESCE(SUM(time_spent_seconds), 0) INTO v_total_time
  FROM public.student_progress
  WHERE student_id = p_user_id;

  FOR v_ach IN
    SELECT * FROM public.achievements WHERE is_active = true
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.user_achievements
      WHERE user_id = p_user_id AND user_achievements.achievement_id = v_ach.id
    ) INTO v_already_has;

    IF v_already_has THEN CONTINUE; END IF;

    DECLARE
      v_meets boolean := false;
      v_cat_completed integer;
    BEGIN
      CASE v_ach.criteria_type
        WHEN 'first_login' THEN
          v_meets := true;

        WHEN 'modules_completed' THEN
          v_meets := v_total_completed >= v_ach.criteria_value;

        WHEN 'streak_days' THEN
          v_meets := v_profile.streak_days >= v_ach.criteria_value;

        WHEN 'perfect_scores' THEN
          v_meets := v_perfect_count >= v_ach.criteria_value;

        WHEN 'coins_earned' THEN
          v_meets := v_total_coins >= v_ach.criteria_value;

        WHEN 'time_spent' THEN
          v_meets := v_total_time >= v_ach.criteria_value;

        WHEN 'specific_category' THEN
          SELECT COUNT(*) INTO v_cat_completed
          FROM public.student_progress sp
          JOIN public.content_modules cm ON cm.id = sp.module_id
          WHERE sp.student_id = p_user_id
            AND sp.status = 'completed'
            AND cm.category = v_ach.criteria_category;
          v_meets := v_cat_completed >= v_ach.criteria_value;

        ELSE
          v_meets := false;
      END CASE;

      IF v_meets THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, earned_at, seen_by_user)
        VALUES (p_user_id, v_ach.id, now(), false);

        UPDATE public.profiles
        SET coins = coins + v_ach.reward_coins
        WHERE id = p_user_id;

        achievement_id := v_ach.id;
        name := v_ach.name;
        rarity := v_ach.rarity;
        RETURN NEXT;
      END IF;
    END;
  END LOOP;

  RETURN;
END;
$function$;

-- 3. Funciones de XP
DROP FUNCTION IF EXISTS public.award_xp_module(uuid);
DROP FUNCTION IF EXISTS public.award_xp_plan_round(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.award_xp_remediation(uuid, integer);
DROP FUNCTION IF EXISTS public._grant_xp(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.calculate_xp(integer, integer, integer, integer, integer, integer, integer);

-- 4. Tablas de XP
DROP TABLE IF EXISTS public.xp_ledger;
DROP TABLE IF EXISTS public.weekly_leaderboards;

-- 5. Columnas de XP y niveles
ALTER TABLE public.achievements DROP COLUMN IF EXISTS reward_xp;
ALTER TABLE public.daily_missions DROP COLUMN IF EXISTS reward_xp;
ALTER TABLE public.content_modules DROP COLUMN IF EXISTS base_xp_reward;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS total_xp, DROP COLUMN IF EXISTS current_level;
ALTER TABLE public.student_progress DROP COLUMN IF EXISTS earned_xp;
ALTER TABLE public.student_remediations DROP COLUMN IF EXISTS bonus_xp_earned;
