-- Función que evalúa todos los achievements pendientes para un usuario
-- y otorga los que cumpla. Devuelve array de IDs nuevos.
-- Llamar después de cada acción significativa: completar lección, subir XP, etc.
CREATE OR REPLACE FUNCTION public.evaluate_achievements(p_user_id uuid)
RETURNS TABLE(achievement_id uuid, name text, rarity text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
        WHEN 'first_login' THEN v_meets := true;
        WHEN 'modules_completed' THEN v_meets := v_total_completed >= v_ach.criteria_value;
        WHEN 'streak_days' THEN v_meets := v_profile.streak_days >= v_ach.criteria_value;
        WHEN 'xp_total' THEN v_meets := v_profile.total_xp >= v_ach.criteria_value;
        WHEN 'perfect_scores' THEN v_meets := v_perfect_count >= v_ach.criteria_value;
        WHEN 'coins_earned' THEN v_meets := v_total_coins >= v_ach.criteria_value;
        WHEN 'time_spent' THEN v_meets := v_total_time >= v_ach.criteria_value;
        WHEN 'specific_category' THEN
          SELECT COUNT(*) INTO v_cat_completed
          FROM public.student_progress sp
          JOIN public.content_modules cm ON cm.id = sp.module_id
          WHERE sp.student_id = p_user_id
            AND sp.status = 'completed'
            AND cm.category = v_ach.criteria_category;
          v_meets := v_cat_completed >= v_ach.criteria_value;
        ELSE v_meets := false;
      END CASE;

      IF v_meets THEN
        INSERT INTO public.user_achievements (user_id, achievement_id, earned_at, seen_by_user)
        VALUES (p_user_id, v_ach.id, now(), false);

        UPDATE public.profiles
        SET coins = coins + v_ach.reward_coins,
            total_xp = total_xp + v_ach.reward_xp
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
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_achievements(uuid) TO authenticated;
