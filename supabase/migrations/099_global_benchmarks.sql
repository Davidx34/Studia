-- 099: memoria global anonima (fase 7 de «IA que aprende con cada curso»).
--
-- Que viaja: SOLO agregados por (materia, nivel, banda de edad, tipo de pregunta): tasa de acierto, intentos, numero de clases y de profesores que aportan. Nunca texto de materiales, preguntas,
-- nombres ni identificadores de estudiantes o de clases. Que NO viaja: nada individual.
--
-- Reglas de seguridad (disenadas en docs/IA_APRENDIZAJE_CONTINUO.md §6):
--   1. Opt-in explicito del profesor POR CLASE (classroom_benchmark_profile.share_opt_in, apagado por defecto, revocable). La revocacion se refleja al recalcular (se hace de inmediato desde la app).
--   2. Taxonomia cerrada (listas CHECK) de materia, nivel y banda de edad: «Matematica», «Matematicas» y «Mates» no fragmentan el benchmark.
--   3. Umbral de anonimato: un agregado solo se publica si lo aportan >= p_min_classes clases Y >= p_min_teachers profesores distintos Y >= p_min_attempts intentos (defaults 5 / 3 / 50).
--      Los umbrales se pueden BAJAR, pero nunca por debajo de un PISO fijo (3 clases, 2 profesores, 20 intentos): por debajo no hay anonimato real y la funcion lo rechaza.
--   4. Es solo un «prior» (valor de arranque de referencia): nunca reemplaza los datos propios de la clase.
--   5. global_benchmarks es solo de servidor (RLS sin politicas); la app entrega a cada profesor unicamente las filas del estrato de su propia clase, y solo si su clase aporta (reciprocidad).
-- Excluye las clases de prueba de carga ([CARGA]...). Aditiva: no cambia datos existentes. Para deshacer: DROP FUNCTION, DROP TABLE global_benchmarks, classroom_benchmark_profile.

CREATE TABLE IF NOT EXISTS public.classroom_benchmark_profile (
  classroom_id    uuid PRIMARY KEY REFERENCES public.classrooms(id) ON DELETE CASCADE,
  subject         text CHECK (subject IN ('matematicas', 'lenguaje', 'ciencias_naturales', 'ciencias_sociales', 'economia', 'ingles', 'tecnologia', 'artes', 'educacion_fisica', 'otra')),
  level           text CHECK (level IN ('primaria', 'secundaria', 'bachillerato', 'universitario', 'otro')),
  age_band        text CHECK (age_band IN ('6-8', '9-11', '12-14', '15-17', '18+')),
  share_opt_in    boolean NOT NULL DEFAULT false,
  opted_in_at     timestamptz,
  opted_in_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  consent_version text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT share_opt_in OR (subject IS NOT NULL AND level IS NOT NULL AND age_band IS NOT NULL AND consent_version IS NOT NULL AND opted_in_at IS NOT NULL))
);

COMMENT ON TABLE public.classroom_benchmark_profile IS 'Estrato de la clase (taxonomia cerrada) y opt-in del profesor para aportar agregados anonimos a la memoria global.';

CREATE TABLE IF NOT EXISTS public.global_benchmarks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject       text NOT NULL,
  level         text NOT NULL,
  age_band      text NOT NULL,
  question_type text NOT NULL,
  n_classes     integer NOT NULL CHECK (n_classes >= 3),
  n_teachers    integer NOT NULL CHECK (n_teachers >= 2),
  attempts      integer NOT NULL CHECK (attempts >= 20),
  correct_rate  numeric(5,4) NOT NULL CHECK (correct_rate BETWEEN 0 AND 1),
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject, level, age_band, question_type)
);

COMMENT ON TABLE public.global_benchmarks IS 'Agregados anonimos por estrato y tipo de pregunta, publicados solo sobre el umbral de anonimato. Prior de referencia, nunca impone. Solo servidor.';

ALTER TABLE public.classroom_benchmark_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY classroom_benchmark_profile_teacher ON public.classroom_benchmark_profile
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_benchmark_profile.classroom_id AND c.teacher_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_benchmark_profile.classroom_id AND c.teacher_id = (SELECT auth.uid())));

REVOKE ALL ON public.classroom_benchmark_profile FROM anon;
REVOKE ALL ON public.global_benchmarks FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_classroom_benchmark_profile_optin ON public.classroom_benchmark_profile (subject, level, age_band) WHERE share_opt_in;
CREATE INDEX IF NOT EXISTS idx_classroom_benchmark_profile_opted_in_by ON public.classroom_benchmark_profile (opted_in_by);

CREATE OR REPLACE FUNCTION public.recompute_global_benchmarks(p_min_classes integer DEFAULT 5, p_min_teachers integer DEFAULT 3, p_min_attempts integer DEFAULT 50) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_n integer;
BEGIN
  IF p_min_classes < 3 OR p_min_teachers < 2 OR p_min_attempts < 20 THEN
    RAISE EXCEPTION 'Umbrales por debajo del piso de anonimato (3 clases, 2 profesores, 20 intentos)';
  END IF;
  DELETE FROM public.global_benchmarks;
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

REVOKE ALL ON FUNCTION public.recompute_global_benchmarks(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_global_benchmarks(integer, integer, integer) TO service_role;
