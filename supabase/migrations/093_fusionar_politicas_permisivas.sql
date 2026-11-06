-- 093: una sola politica PERMISIVA por (tabla, comando) (aviso «multiple_permissive_policies» del linter de Supabase).
--
-- Problema: cuando una tabla tiene varias politicas permisivas para el mismo comando, Postgres las evalua TODAS en cada consulta y las une con OR. Fusionarlas en una sola con `USING (a OR b)` da
-- exactamente el mismo resultado (las politicas permisivas ya se combinan con OR) y evita evaluarlas por separado.
--
-- Estado verificado en produccion (solo lectura, 2026-11-06): 22 grupos (tabla, comando) con 2 politicas permisivas cada uno, todas para {public}: blueprint_module_links, class_enrollments,
-- classroom_ai_config, classroom_concepts (SELECT e INSERT), classroom_learning_objectives, classrooms, content_modules, course_blueprints, exam_attempts, lab_attempts, labs, material_chunks,
-- material_chunks_processed (SELECT, INSERT y UPDATE), profiles, question_attempts, remediation_plans, student_progress, student_remediations, teaching_materials. Algunas politicas son FOR ALL
-- (p. ej. las del profesor sobre su contenido): al fusionar se parten en una politica por comando, con la misma expresion.
--
-- Regla de equivalencia: para cada tabla afectada y cada comando (SELECT, INSERT, UPDATE, DELETE) se crea UNA politica `<tabla>_<comando>` cuya expresion es el OR de las expresiones efectivas de todas las
-- politicas permisivas que aplicaban a ese comando (una politica FOR ALL sin USING usa su WITH CHECK, y sin WITH CHECK usa su USING, como hace Postgres). Luego se borran las originales. Todo en una
-- transaccion: no hay un instante sin politicas. Solo se tocan tablas cuyas politicas son todas PERMISSIVE para {public}; cualquier otra se omite (con aviso).
-- Idempotente: tras correr, ninguna tabla tiene grupos con mas de una politica y no hay nada que fusionar.
--
-- Verificado antes de escribir esto en una transaccion revertida: para los 32 usuarios y el rol anonimo y cada tabla de `public`, el conjunto de filas visibles es identico antes y despues.
--
-- Para deshacer: recrear las politicas originales (sus nombres y expresiones estan en la migracion que las creo y en el historial de este archivo).

DO $m$
DECLARE
  t record;
  c text;
  pol record;
  v_using text;
  v_check text;
  v_n int;
  v_name text;
  v_drops text[];
  v_creates text[];
  s text;
  v_tables int := 0;
BEGIN
  FOR t IN
    SELECT tablename FROM (
      SELECT p.tablename, cmds.c, count(*) AS n
      FROM pg_policies p
      JOIN LATERAL (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) cmds(c) ON (p.cmd = cmds.c OR p.cmd = 'ALL')
      WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE'
      GROUP BY p.tablename, cmds.c
      HAVING count(*) > 1
    ) g
    GROUP BY tablename
    ORDER BY tablename
  LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t.tablename AND (permissive <> 'PERMISSIVE' OR roles::text <> '{public}')) THEN
      RAISE NOTICE '093: se omite % (tiene politicas restrictivas o para roles concretos)', t.tablename;
      CONTINUE;
    END IF;

    v_drops := ARRAY[]::text[];
    v_creates := ARRAY[]::text[];
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t.tablename LOOP
      v_drops := v_drops || format('DROP POLICY %I ON public.%I', pol.policyname, t.tablename);
    END LOOP;

    FOREACH c IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      -- Expresiones efectivas de las politicas que aplican a este comando.
      SELECT count(*),
             string_agg('(' || coalesce(p.qual, p.with_check) || ')', ' OR ' ORDER BY p.policyname) FILTER (WHERE coalesce(p.qual, p.with_check) IS NOT NULL),
             string_agg('(' || coalesce(p.with_check, p.qual) || ')', ' OR ' ORDER BY p.policyname) FILTER (WHERE coalesce(p.with_check, p.qual) IS NOT NULL),
             count(*) FILTER (WHERE coalesce(p.qual, p.with_check) IS NULL)
      INTO v_n, v_using, v_check, s
      FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.tablename AND (p.cmd = c OR p.cmd = 'ALL');
      IF v_n = 0 THEN CONTINUE; END IF;
      IF s::int > 0 THEN RAISE EXCEPTION '093: una politica de % sobre % no tiene expresion', c, t.tablename; END IF;
      v_name := left(t.tablename, 50) || '_' || lower(c);
      IF c = 'INSERT' THEN
        v_creates := v_creates || format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR INSERT TO public WITH CHECK (%s)', v_name, t.tablename, v_check);
      ELSIF c = 'UPDATE' THEN
        v_creates := v_creates || format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR UPDATE TO public USING (%s) WITH CHECK (%s)', v_name, t.tablename, v_using, v_check);
      ELSE
        v_creates := v_creates || format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO public USING (%s)', v_name, t.tablename, c, v_using);
      END IF;
    END LOOP;

    FOREACH s IN ARRAY v_drops LOOP EXECUTE s; END LOOP;
    FOREACH s IN ARRAY v_creates LOOP EXECUTE s; END LOOP;
    v_tables := v_tables + 1;
  END LOOP;
  RAISE NOTICE '093: % tablas con politicas fusionadas', v_tables;
END
$m$;
