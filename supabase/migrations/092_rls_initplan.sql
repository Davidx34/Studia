-- 092: politicas RLS con `auth.uid()` evaluado UNA vez por consulta (aviso «auth_rls_initplan» del linter de Supabase).
--
-- Problema: en una politica, `auth.uid()` suelto se vuelve a evaluar por CADA fila; escrito como `(SELECT auth.uid())` Postgres lo evalua una sola vez (InitPlan) y lo reutiliza. El resultado
-- es exactamente el mismo (auth.uid() es estable dentro de una consulta); solo cambia el costo cuando una tabla crece.
--
-- Estado verificado en produccion (solo lectura, 2026-11-06): 19 politicas con `auth.uid()` sin envolver (blueprint_module_links, class_memory, class_memory_material, course_blueprints, exam_attempts,
-- exam_questions, exam_sessions, generated_questions, lab_attempts, labs), todas PERMISSIVE para {public}. Este archivo NO las lista a mano: recorre pg_policies y reescribe exactamente las que lo
-- necesitan (idempotente: una politica ya envuelta no se vuelve a tocar). Se preservan nombre, comando, roles y la forma de las expresiones; solo cambia `auth.uid()` por `(SELECT auth.uid())`.
-- Tambien envuelve auth.role() y auth.jwt() si aparecieran sueltos.
--
-- Para deshacer: reescribir las expresiones sin el SELECT (la semantica es identica; no hace falta salvo por la regla de estilo).

DO $m$
DECLARE
  p record;
  v_using text;
  v_check text;
  v_sql text;
  v_changed int := 0;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND ( (qual IS NOT NULL AND qual ~ 'auth\.(uid|role|jwt)\(\)' AND qual !~ '\(\s*SELECT\s+auth\.(uid|role|jwt)\(\)')
         OR (with_check IS NOT NULL AND with_check ~ 'auth\.(uid|role|jwt)\(\)' AND with_check !~ '\(\s*SELECT\s+auth\.(uid|role|jwt)\(\)') )
  LOOP
    v_using := CASE WHEN p.qual IS NULL THEN NULL ELSE regexp_replace(p.qual, 'auth\.(uid|role|jwt)\(\)', '(SELECT auth.\1())', 'g') END;
    v_check := CASE WHEN p.with_check IS NULL THEN NULL ELSE regexp_replace(p.with_check, 'auth\.(uid|role|jwt)\(\)', '(SELECT auth.\1())', 'g') END;
    v_sql := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF v_using IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_using || ')'; END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_check || ')'; END IF;
    EXECUTE v_sql;
    v_changed := v_changed + 1;
  END LOOP;
  RAISE NOTICE '092: % politicas reescritas', v_changed;
END
$m$;
