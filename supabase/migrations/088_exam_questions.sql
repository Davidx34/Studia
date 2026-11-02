-- 088: banco de PREGUNTAS DE EXAMEN del plan por cortes (docs/EVALUACIONES.md, decision 1B: la IA escribe preguntas propias del examen).
--
-- Cada pregunta nace atada a TRES cosas y la base lo comprueba: la comprension final que mide + el modulo del plan donde se ensena (y ese modulo debe estar en un objetivo que contribuye a esa
-- comprension), el MATERIAL de la clase en que se apoya (con una cita textual, comprobada en la aplicacion contra el texto del trozo) y una explicacion de fondo. Pertenece a UNA version del plan
-- (no se copia entre versiones: los ids de modulo pueden reutilizarse con otro significado al regenerar). Aditiva: no toca ninguna tabla existente.
--
-- Seguridad (todo lo que llega del navegador es no confiable):
--   - Esta tabla tiene las CLAVES de calificacion (opciones correctas, respuestas, parejas): un estudiante NO la lee JAMAS (no hay politica para estudiantes; ni siquiera su resultado la toca).
--   - SELECT: solo el profesor dueño de la clase (para revisar). Escribir (INSERT/UPDATE/DELETE) NADIE desde el navegador: lo hace el servidor despues de comprobar sesion y propiedad.
--   - Ultima barrera en la base: el modulo existe en el plan y ensena esa comprension; el material es de LA MISMA clase; el plan no esta archivado; la forma de la clave coincide con el tipo; el
--     CONTENIDO no se edita despues (para cambiarlo se rechaza y se genera otra); revisada <=> tiene fecha de revision.
--   - Un examen solo usa preguntas APROBADAS por el profesor ('approved'). 'judge_verdict' dice que dijo el juez de sustento ('not_judged' = nadie la juzgo; NO es lo mismo que aprobada).

CREATE TABLE IF NOT EXISTS public.exam_questions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id       uuid NOT NULL,
  classroom_id       uuid NOT NULL,
  -- Ids dentro del documento del plan (mismo formato que parseBlueprint).
  outcome_id         text NOT NULL CHECK (outcome_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  node_id            text NOT NULL CHECK (node_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  type               text NOT NULL CHECK (type IN ('multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match')),
  q                  text NOT NULL CHECK (char_length(q) BETWEEN 1 AND 600),
  opts               jsonb CHECK (opts IS NULL OR (jsonb_typeof(opts) = 'array' AND pg_column_size(opts) < 4000)),
  ok                 jsonb CHECK (ok IS NULL OR jsonb_typeof(ok) IN ('number', 'boolean')),
  answers            jsonb CHECK (answers IS NULL OR (jsonb_typeof(answers) = 'array' AND pg_column_size(answers) < 2000)),
  keywords           jsonb CHECK (keywords IS NULL OR (jsonb_typeof(keywords) = 'array' AND pg_column_size(keywords) < 2000)),
  pairs              jsonb CHECK (pairs IS NULL OR (jsonb_typeof(pairs) = 'array' AND pg_column_size(pairs) < 4000)),
  exp                text NOT NULL CHECK (char_length(exp) BETWEEN 40 AND 1200),
  -- El material explicito en que se apoya (lo que el estudiante ve al terminar): el trozo y una cita textual de el.
  source_material_id uuid NOT NULL REFERENCES public.teaching_materials(id) ON DELETE CASCADE,
  source_chunk       integer NOT NULL CHECK (source_chunk >= 0),
  source_quote       text NOT NULL CHECK (char_length(source_quote) BETWEEN 25 AND 400),
  review_status      text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  judge_verdict      text NOT NULL DEFAULT 'not_judged' CHECK (judge_verdict IN ('supported', 'unclear', 'not_judged')),
  judge_problems     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(judge_problems) = 'array' AND pg_column_size(judge_problems) < 4000),
  reviewed_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_questions_blueprint_fk FOREIGN KEY (blueprint_id, classroom_id) REFERENCES public.course_blueprints (id, classroom_id) ON DELETE CASCADE,
  -- Revisada <=> tiene fecha de revision.
  CONSTRAINT exam_questions_reviewed_at CHECK ((review_status = 'pending') = (reviewed_at IS NULL)),
  -- La clave tiene la forma que su tipo necesita (la aplicacion ademas la califica con los calificadores reales antes de guardar).
  CONSTRAINT exam_questions_key_shape CHECK (
    CASE type
      WHEN 'multiple_choice' THEN opts IS NOT NULL AND jsonb_array_length(opts) BETWEEN 2 AND 8 AND ok IS NOT NULL AND jsonb_typeof(ok) = 'number' AND (ok #>> '{}')::numeric >= 0 AND (ok #>> '{}')::numeric < jsonb_array_length(opts)
      WHEN 'true_false' THEN ok IS NOT NULL AND jsonb_typeof(ok) = 'boolean'
      WHEN 'fill_blank' THEN answers IS NOT NULL AND jsonb_array_length(answers) >= 1
      WHEN 'short_answer' THEN keywords IS NOT NULL AND jsonb_array_length(keywords) >= 1
      WHEN 'match' THEN pairs IS NOT NULL AND jsonb_array_length(pairs) >= 2
      ELSE false
    END
  )
);

-- La misma pregunta (mismo enunciado) no se guarda dos veces en un plan.
CREATE UNIQUE INDEX IF NOT EXISTS exam_questions_unique_q ON public.exam_questions (blueprint_id, md5(q));
CREATE INDEX IF NOT EXISTS idx_exam_questions_bank ON public.exam_questions (blueprint_id, review_status);
CREATE INDEX IF NOT EXISTS idx_exam_questions_material ON public.exam_questions (source_material_id);

CREATE OR REPLACE FUNCTION public.exam_questions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  bp record;
  material_class uuid;
BEGIN
  SELECT status, doc INTO bp FROM public.course_blueprints WHERE id = NEW.blueprint_id AND classroom_id = NEW.classroom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El plan no existe en esa clase' USING ERRCODE = '23514';
  END IF;
  IF bp.status = 'archived' THEN
    RAISE EXCEPTION 'Un plan archivado no recibe preguntas' USING ERRCODE = '23514';
  END IF;

  -- El modulo existe en el plan y esta en un objetivo que contribuye a ESA comprension.
  IF NOT (
    CASE WHEN jsonb_typeof(bp.doc -> 'periods') = 'array'
      THEN jsonb_path_exists(bp.doc, '$.periods[*].objectives[*] ? (@.modules[*].id == $nid && @.outcomeIds[*] == $oid)', jsonb_build_object('nid', NEW.node_id, 'oid', NEW.outcome_id))
      ELSE false END
  ) THEN
    RAISE EXCEPTION 'El modulo no existe en el plan o no ensena esa comprension final' USING ERRCODE = '23514';
  END IF;

  -- El material es de la MISMA clase que el plan.
  SELECT classroom_id INTO material_class FROM public.teaching_materials WHERE id = NEW.source_material_id;
  IF material_class IS DISTINCT FROM NEW.classroom_id THEN
    RAISE EXCEPTION 'El material no pertenece a la clase del plan' USING ERRCODE = '23514';
  END IF;

  -- Una pregunta nueva nace sin revisar.
  IF NEW.review_status <> 'pending' OR NEW.reviewed_by IS NOT NULL THEN
    RAISE EXCEPTION 'Una pregunta nueva debe nacer pendiente de revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_questions_guard ON public.exam_questions;
CREATE TRIGGER exam_questions_guard
  BEFORE INSERT ON public.exam_questions
  FOR EACH ROW EXECUTE PROCEDURE public.exam_questions_guard();

-- El CONTENIDO de una pregunta no se edita (lo que el profesor aprobo es lo que se sirve): solo cambia su revision. Para cambiarla se rechaza y se genera otra.
CREATE OR REPLACE FUNCTION public.exam_questions_content_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.blueprint_id, NEW.classroom_id, NEW.outcome_id, NEW.node_id, NEW.type, NEW.q, NEW.opts, NEW.ok, NEW.answers, NEW.keywords, NEW.pairs, NEW.exp, NEW.source_material_id, NEW.source_chunk, NEW.source_quote, NEW.judge_verdict, NEW.judge_problems)
     IS DISTINCT FROM
     (OLD.blueprint_id, OLD.classroom_id, OLD.outcome_id, OLD.node_id, OLD.type, OLD.q, OLD.opts, OLD.ok, OLD.answers, OLD.keywords, OLD.pairs, OLD.exp, OLD.source_material_id, OLD.source_chunk, OLD.source_quote, OLD.judge_verdict, OLD.judge_problems) THEN
    RAISE EXCEPTION 'El contenido de una pregunta no se edita: rechazala y genera otra' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_questions_content_immutable ON public.exam_questions;
CREATE TRIGGER exam_questions_content_immutable
  BEFORE UPDATE ON public.exam_questions
  FOR EACH ROW EXECUTE PROCEDURE public.exam_questions_content_immutable();

ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;

-- Profesor dueño de la clase: ve las preguntas de su clase (para revisarlas). NINGUNA politica para estudiantes: la tabla tiene las claves.
DROP POLICY IF EXISTS exam_questions_teacher_select ON public.exam_questions;
CREATE POLICY exam_questions_teacher_select ON public.exam_questions
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

-- ───────────────────────────── permisos ─────────────────────────────
-- Solo lectura desde el navegador (y solo el profesor dueño, por la politica). service_role ignora RLS: es quien escribe las preguntas ya validadas y las revisiones.
REVOKE ALL ON TABLE public.exam_questions FROM anon, authenticated;
GRANT SELECT ON TABLE public.exam_questions TO authenticated;

REVOKE ALL ON FUNCTION public.exam_questions_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exam_questions_content_immutable() FROM PUBLIC;

COMMENT ON TABLE public.exam_questions IS 'Preguntas de examen del plan por cortes, escritas por la IA y revisadas por el profesor. TIENE LAS CLAVES: solo la lee el profesor dueño y el servidor; nunca un estudiante. Un examen solo usa las aprobadas.';
