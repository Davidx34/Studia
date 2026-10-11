-- Rendimiento (aviso del linter de Supabase, revision 2026-10-11).
--
-- 1) auth_rls_initplan (79 politicas): una politica que llama auth.uid() / auth.role() / current_setting() "pelado"
--    reevalua esa funcion por CADA FILA que examina. Envuelta en (SELECT ...) Postgres la evalua UNA vez por
--    consulta (InitPlan). El resultado es identico (esas funciones son estables dentro de una sentencia); solo
--    cambia cuanto cuesta. Con las tablas actuales (decenas de filas) no se nota; importa cuando crezca el numero
--    de estudiantes y de intentos.
--    Se reescribe SOLO el texto de USING / WITH CHECK, sin tocar roles, comando ni nombre de cada politica
--    (ALTER POLICY ... USING / WITH CHECK). Idempotente: lo ya envuelto ("( SELECT auth.uid() AS uid)") no se toca.
--
-- 2) unindexed_foreign_keys (19 claves foraneas sin indice): cada JOIN o borrado en cascada sobre la tabla padre
--    obliga a recorrer la tabla hija completa. Se crean los indices que faltan (tablas pequeñas: milisegundos).
--
-- NO se tocan aqui (decision consciente): multiple_permissive_policies (fusionar politicas cambia la semantica y
-- exige revisarlas una a una) ni unused_index (con tan pocos datos "sin usar" no es una señal fiable).

DO $$
DECLARE
  r record;
  new_using text;
  new_check text;
  clauses text;
  changed integer := 0;
  -- Funciones de sesion sin envolver. La alternativa negativa evita envolver dos veces lo que ya esta envuelto.
  pat constant text := '(?<!SELECT )(auth\.(?:uid|role|jwt)\(\)|current_setting\([^()]*\))';
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  LOOP
    new_using := CASE WHEN r.qual IS NULL THEN NULL ELSE regexp_replace(r.qual, pat, '(SELECT \1)', 'g') END;
    new_check := CASE WHEN r.with_check IS NULL THEN NULL ELSE regexp_replace(r.with_check, pat, '(SELECT \1)', 'g') END;

    clauses := '';
    IF new_using IS NOT NULL AND new_using IS DISTINCT FROM r.qual THEN
      clauses := clauses || format(' USING (%s)', new_using);
    END IF;
    IF new_check IS NOT NULL AND new_check IS DISTINCT FROM r.with_check THEN
      clauses := clauses || format(' WITH CHECK (%s)', new_check);
    END IF;

    IF clauses <> '' THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I%s', r.policyname, r.schemaname, r.tablename, clauses);
      changed := changed + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Politicas reescritas: %', changed;
END $$;

CREATE INDEX IF NOT EXISTS idx_class_media_created_by ON public.class_media (created_by);
CREATE INDEX IF NOT EXISTS idx_classroom_ai_config_teacher_id ON public.classroom_ai_config (teacher_id);
CREATE INDEX IF NOT EXISTS idx_classroom_learning_objectives_teacher_id ON public.classroom_learning_objectives (teacher_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_teacher_id ON public.classrooms (teacher_id);
CREATE INDEX IF NOT EXISTS idx_content_modules_teacher_id ON public.content_modules (teacher_id);
CREATE INDEX IF NOT EXISTS idx_pending_enrollments_teacher_id ON public.pending_enrollments (teacher_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_module_id ON public.question_attempts (module_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_question_id ON public.question_attempts (question_id);
CREATE INDEX IF NOT EXISTS idx_remediation_plans_created_by ON public.remediation_plans (created_by);
CREATE INDEX IF NOT EXISTS idx_student_card_state_card_id ON public.student_card_state (card_id);
CREATE INDEX IF NOT EXISTS idx_student_remediations_module_id ON public.student_remediations (module_id);
CREATE INDEX IF NOT EXISTS idx_study_notes_material_id ON public.study_notes (material_id);
CREATE INDEX IF NOT EXISTS idx_tonito_conversations_module_id ON public.tonito_conversations (module_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement_id ON public.user_achievements (achievement_id);
CREATE INDEX IF NOT EXISTS idx_user_inventory_item_id ON public.user_inventory (item_id);
CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id ON public.user_inventory (user_id);
CREATE INDEX IF NOT EXISTS idx_user_missions_mission_id ON public.user_missions (mission_id);
CREATE INDEX IF NOT EXISTS idx_weekly_leaderboards_classroom_id ON public.weekly_leaderboards (classroom_id);
CREATE INDEX IF NOT EXISTS idx_weekly_leaderboards_user_id ON public.weekly_leaderboards (user_id);
