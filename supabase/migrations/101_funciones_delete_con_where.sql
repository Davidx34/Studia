-- 101: corrige recompute_question_stats() (096) y recompute_global_benchmarks() (099): fallaban al llamarse por la API.
--
-- Causa: Supabase activa la extension pg_safeupdate para los roles de la API (PostgREST): un DELETE sin WHERE se rechaza con «DELETE requires a WHERE clause» (error 21000), TAMBIEN dentro de una funcion
-- llamada por rpc(). Las dos funciones empezaban con `DELETE FROM <tabla>` a secas. Pasaron mis pruebas en SQL porque esas corren como administrador de la base, sin pg_safeupdate; fallaron en produccion
-- al usarlas desde la app y desde el panel /dev (reproducido con la llave de servicio: ERROR 21000).
--
-- Arreglo: `DELETE FROM <tabla> WHERE true` (pg_safeupdate exige la clausula, no que filtre). Mismo comportamiento; el resto del cuerpo es identico al de 096 y 099.
-- Para deshacer: volver a las definiciones de 096/099 (no conviene: vuelven a fallar por la API).

CREATE OR REPLACE FUNCTION public.recompute_question_stats() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.question_stats WHERE true;
  INSERT INTO public.question_stats (question_id, classroom_id, attempts, correct, correct_rate, distinct_students, last_attempt_at)
  SELECT qa.question_id, min(qa.classroom_id::text)::uuid, count(*), count(*) FILTER (WHERE qa.was_correct),
         round(avg(qa.was_correct::int)::numeric, 4), count(DISTINCT qa.student_id), max(qa.attempted_at)
  FROM public.question_attempts qa
  JOIN public.lesson_questions q ON q.id = qa.question_id
  JOIN public.classrooms c ON c.id = qa.classroom_id
  WHERE c.name NOT LIKE '[CARGA]%'
  GROUP BY qa.question_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$f$;

CREATE OR REPLACE FUNCTION public.recompute_global_benchmarks(p_min_classes integer DEFAULT 5, p_min_teachers integer DEFAULT 3, p_min_attempts integer DEFAULT 50) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_n integer;
BEGIN
  IF p_min_classes < 3 OR p_min_teachers < 2 OR p_min_attempts < 20 THEN
    RAISE EXCEPTION 'Umbrales por debajo del piso de anonimato (3 clases, 2 profesores, 20 intentos)';
  END IF;
  DELETE FROM public.global_benchmarks WHERE true;
  INSERT INTO public.global_benchmarks (subject, level, age_band, question_type, n_classes, n_teachers, attempts, correct_rate)
  SELECT p.subject, p.level, p.age_band, q.type,
         count(DISTINCT c.id), count(DISTINCT c.teacher_id), count(*), round(avg(qa.was_correct::int)::numeric, 4)
  FROM public.question_attempts qa
  JOIN public.lesson_questions q ON q.id = qa.question_id
  JOIN public.classrooms c ON c.id = qa.classroom_id
  JOIN public.classroom_benchmark_profile p ON p.classroom_id = c.id AND p.share_opt_in
  WHERE c.name NOT LIKE '[CARGA]%' AND q.type IS NOT NULL
  GROUP BY p.subject, p.level, p.age_band, q.type
  HAVING count(DISTINCT c.id) >= p_min_classes AND count(DISTINCT c.teacher_id) >= p_min_teachers AND count(*) >= p_min_attempts;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$f$;

-- CREATE OR REPLACE conserva los permisos existentes; se repiten por claridad (solo service_role).
REVOKE ALL ON FUNCTION public.recompute_question_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_question_stats() TO service_role;
REVOKE ALL ON FUNCTION public.recompute_global_benchmarks(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_global_benchmarks(integer, integer, integer) TO service_role;
