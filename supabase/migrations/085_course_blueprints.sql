-- 085: plan del curso por cortes (docs/PLAN_POR_CORTES.md): el plan versionado y los intentos de las evaluaciones de corte y final.
--
-- Dos tablas, cada una con el modelo que le corresponde (docs/ESCALABILIDAD_DE_DATOS.md):
--   - course_blueprints: el PLAN es un DOCUMENTO jsonb (comprensiones finales, cortes con su ponderacion, objetivos, modulos) validado en la app con parseBlueprint + checkBlueprint
--     (src/lib/blueprint). Una fila por version: un plan publicado es INMUTABLE; cambiarlo crea una version nueva, asi los intentos de los estudiantes siguen apuntando a la version con la
--     que se hicieron (regenerar no destruye intentos).
--   - exam_attempts: los INTENTOS de las evaluaciones son relacionales (integridad, historial inmutable, consultas por estudiante y clase). La nota de una evaluacion es el promedio de
--     todos sus intentos hasta llegar al 100 %; los intentos son ilimitados hasta ese 100 %.
--
-- Seguridad (todo lo que llega del navegador es no confiable):
--   - NADIE escribe directo desde el navegador (anon y authenticated no tienen INSERT/UPDATE/DELETE): el plan lo escribe el servidor despues de comprobar que quien pide es el profesor dueño
--     y de validar el documento; el intento lo escribe el servidor despues de CALIFICAR la evaluacion. Una politica de INSERT dejaria saltarse al validador con la llave publica.
--   - SELECT: el profesor dueño de la clase ve todo lo de su clase; el estudiante ve solo los planes PUBLICADOS de las clases donde esta matriculado y solo SUS intentos.
--   - Ultima barrera en la base: tipo y tamaño del documento, coherencia version/documento, un solo borrador y un solo plan publicado por clase, transiciones de estado validas
--     (borrador -> publicado -> archivado), un plan publicado no se edita, los intentos son un historial que no se modifica.
--   - Un intento solo se inserta si el plan esta publicado, el estudiante esta matriculado en la clase del plan, el corte existe en el plan y la evaluacion no se dominó ya (100 %). El
--     numero de intento lo asigna la base bajo un candado por (plan, estudiante, evaluacion): dos intentos simultaneos no repiten numero.
--
-- Lo que la base NO impone (lo impone la aplicacion, src/lib/blueprint/progress.ts): el ORDEN del recorrido (la evaluacion de un corte se desbloquea al dominar sus modulos; la final al
-- terminar todos los cortes). Aditiva: no toca ninguna tabla existente; si la migracion no esta aplicada, la aplicacion no usa el plan por cortes.

-- ───────────────────────────── el plan ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.course_blueprints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  teacher_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version >= 1),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  doc          jsonb NOT NULL CHECK (jsonb_typeof(doc) = 'object' AND pg_column_size(doc) < 400000),
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_blueprints_class_version UNIQUE (classroom_id, version),
  -- Para que exam_attempts pueda apuntar a (plan, clase) y la base garantice que son de la misma clase.
  CONSTRAINT course_blueprints_id_class UNIQUE (id, classroom_id),
  -- El numero de version del documento es el de la fila.
  CONSTRAINT course_blueprints_doc_version CHECK (CASE WHEN jsonb_typeof(doc -> 'version') = 'number' THEN (doc ->> 'version')::numeric = version ELSE false END),
  -- Solo un plan ya publicado (o archivado) tiene fecha de publicacion.
  CONSTRAINT course_blueprints_published_at CHECK ((status = 'draft') = (published_at IS NULL))
);

-- Un solo borrador de trabajo y un solo plan publicado por clase.
CREATE UNIQUE INDEX IF NOT EXISTS course_blueprints_one_draft ON public.course_blueprints (classroom_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS course_blueprints_one_published ON public.course_blueprints (classroom_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_course_blueprints_teacher ON public.course_blueprints (teacher_id);

CREATE OR REPLACE FUNCTION public.course_blueprints_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.classroom_id <> OLD.classroom_id OR NEW.teacher_id <> OLD.teacher_id OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'Un plan no cambia de clase, de dueño ni de version' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND NEW.doc IS DISTINCT FROM OLD.doc THEN
    RAISE EXCEPTION 'Un plan publicado no se edita: crea una version nueva' USING ERRCODE = '23514';
  END IF;
  IF NOT (OLD.status = NEW.status OR (OLD.status = 'draft' AND NEW.status = 'published') OR (OLD.status = 'published' AND NEW.status = 'archived')) THEN
    RAISE EXCEPTION 'Transicion de estado invalida (% -> %)', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS course_blueprints_guard ON public.course_blueprints;
CREATE TRIGGER course_blueprints_guard
  BEFORE UPDATE ON public.course_blueprints
  FOR EACH ROW EXECUTE PROCEDURE public.course_blueprints_guard();

DROP TRIGGER IF EXISTS course_blueprints_updated_at ON public.course_blueprints;
CREATE TRIGGER course_blueprints_updated_at
  BEFORE UPDATE ON public.course_blueprints
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

ALTER TABLE public.course_blueprints ENABLE ROW LEVEL SECURITY;

-- Profesor dueño de la clase: ve todas las versiones de su plan.
DROP POLICY IF EXISTS course_blueprints_teacher_select ON public.course_blueprints;
CREATE POLICY course_blueprints_teacher_select ON public.course_blueprints
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

-- Estudiante: solo el plan PUBLICADO de una clase donde esta matriculado.
DROP POLICY IF EXISTS course_blueprints_student_select ON public.course_blueprints;
CREATE POLICY course_blueprints_student_select ON public.course_blueprints
  FOR SELECT USING (
    status = 'published'
    AND EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = course_blueprints.classroom_id AND ce.student_id = auth.uid())
  );

-- ───────────────────────────── los intentos de las evaluaciones ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id   uuid NOT NULL,
  classroom_id   uuid NOT NULL,
  student_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 'period' = la evaluacion de un corte; 'final' = la evaluacion final.
  kind           text NOT NULL CHECK (kind IN ('period', 'final')),
  -- Id del corte dentro del documento del plan (ids de 1 a 40 letras, numeros, "_" o "-"); NULL en la evaluacion final.
  period_id      text CHECK (period_id IS NULL OR period_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  -- Lo asigna la base (1, 2, 3...): el navegador y el servidor no lo eligen.
  attempt_number integer NOT NULL DEFAULT 0 CHECK (attempt_number >= 0),
  score_percent  numeric(5, 2) NOT NULL CHECK (score_percent >= 0 AND score_percent <= 100),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_attempts_blueprint_fk FOREIGN KEY (blueprint_id, classroom_id) REFERENCES public.course_blueprints (id, classroom_id) ON DELETE CASCADE,
  CONSTRAINT exam_attempts_classroom_fk FOREIGN KEY (classroom_id) REFERENCES public.classrooms (id) ON DELETE CASCADE,
  -- La evaluacion final no tiene corte; la de un corte si.
  CONSTRAINT exam_attempts_kind_period CHECK ((kind = 'final') = (period_id IS NULL))
);

-- Un numero de intento por (plan, estudiante, evaluacion). COALESCE: en la final period_id es NULL y los NULL no cuentan como iguales en un indice unico.
CREATE UNIQUE INDEX IF NOT EXISTS exam_attempts_unique_number
  ON public.exam_attempts (blueprint_id, student_id, kind, COALESCE(period_id, ''), attempt_number);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON public.exam_attempts (student_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_classroom ON public.exam_attempts (classroom_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.exam_attempts_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  bp record;
  last_n integer;
  mastered boolean;
BEGIN
  SELECT status, doc INTO bp FROM public.course_blueprints WHERE id = NEW.blueprint_id AND classroom_id = NEW.classroom_id;
  IF NOT FOUND OR bp.status <> 'published' THEN
    RAISE EXCEPTION 'El plan no esta publicado' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = NEW.classroom_id AND ce.student_id = NEW.student_id) THEN
    RAISE EXCEPTION 'El estudiante no esta matriculado en la clase del plan' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'period' AND NOT (
    CASE WHEN jsonb_typeof(bp.doc -> 'periods') = 'array'
      THEN EXISTS (SELECT 1 FROM jsonb_array_elements(bp.doc -> 'periods') p WHERE p ->> 'id' = NEW.period_id)
      ELSE false END
  ) THEN
    RAISE EXCEPTION 'El corte no existe en el plan' USING ERRCODE = '23514';
  END IF;

  -- Dos intentos simultaneos del mismo estudiante en la misma evaluacion se atienden uno tras otro.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.blueprint_id::text || ':' || NEW.student_id::text || ':' || NEW.kind || ':' || COALESCE(NEW.period_id, ''), 0));

  SELECT COALESCE(max(attempt_number), 0), COALESCE(bool_or(score_percent >= 100), false)
    INTO last_n, mastered
    FROM public.exam_attempts
   WHERE blueprint_id = NEW.blueprint_id AND student_id = NEW.student_id AND kind = NEW.kind AND period_id IS NOT DISTINCT FROM NEW.period_id;
  IF mastered THEN
    RAISE EXCEPTION 'La evaluacion ya se domino (100 %%): no se repite' USING ERRCODE = '23514';
  END IF;

  NEW.attempt_number := last_n + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_attempts_before_insert ON public.exam_attempts;
CREATE TRIGGER exam_attempts_before_insert
  BEFORE INSERT ON public.exam_attempts
  FOR EACH ROW EXECUTE PROCEDURE public.exam_attempts_before_insert();

-- Un intento es un registro historico: no se modifica (los borrados en cascada, al borrar la clase o el estudiante, siguen funcionando).
CREATE OR REPLACE FUNCTION public.exam_attempts_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Un intento de evaluacion no se modifica' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS exam_attempts_immutable ON public.exam_attempts;
CREATE TRIGGER exam_attempts_immutable
  BEFORE UPDATE ON public.exam_attempts
  FOR EACH ROW EXECUTE PROCEDURE public.exam_attempts_immutable();

ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;

-- Estudiante: solo lee los suyos.
DROP POLICY IF EXISTS exam_attempts_student_select ON public.exam_attempts;
CREATE POLICY exam_attempts_student_select ON public.exam_attempts
  FOR SELECT USING (student_id = auth.uid());

-- Profesor dueño de la clase: lee los de su clase.
DROP POLICY IF EXISTS exam_attempts_teacher_select ON public.exam_attempts;
CREATE POLICY exam_attempts_teacher_select ON public.exam_attempts
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

-- ───────────────────────────── permisos ─────────────────────────────
-- Solo lectura desde el navegador. (service_role ignora RLS y conserva todo: es quien escribe el plan validado y los intentos ya calificados.)
REVOKE ALL ON TABLE public.course_blueprints FROM anon, authenticated;
REVOKE ALL ON TABLE public.exam_attempts FROM anon, authenticated;
GRANT SELECT ON TABLE public.course_blueprints TO authenticated;
GRANT SELECT ON TABLE public.exam_attempts TO authenticated;

REVOKE ALL ON FUNCTION public.course_blueprints_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exam_attempts_before_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exam_attempts_immutable() FROM PUBLIC;

COMMENT ON TABLE public.course_blueprints IS 'Plan del curso por cortes (documento jsonb, una fila por version). Un plan publicado es inmutable. Lo escribe SOLO el servidor, ya validado (src/lib/blueprint).';
COMMENT ON TABLE public.exam_attempts IS 'Intentos de las evaluaciones de corte y final, calificados en el servidor. Historial inmutable; el numero de intento lo asigna la base y no se repite tras un 100 %.';
