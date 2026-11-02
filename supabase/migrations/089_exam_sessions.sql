-- 089: SESION de examen del plan por cortes (docs/EVALUACIONES.md, «Sesion de examen»).
--
-- Una sesion fija QUE preguntas se le sirvieron a un estudiante en UN intento de una evaluacion (un corte o la final) y COMO se barajaron sus opciones. Al cerrarla, el servidor califica
-- contra ESO (no contra lo que diga el navegador), escribe el intento en exam_attempts y guarda los resultados por pregunta (para releer la retroalimentacion). Aditiva: no cambia ninguna
-- tabla existente.
--
-- Seguridad (todo lo que llega del navegador es no confiable):
--   - NINGUNA politica para estudiantes y ninguna escritura desde el navegador: el estudiante recibe las preguntas por el servidor (sin claves) y manda sus respuestas al servidor. La
--     sesion no tiene claves, pero si QUE preguntas salieron y su barajado; no se expone.
--   - SELECT: solo el profesor dueño de la clase. Escribe el servidor (service_role), tras comprobar sesion y matricula.
--   - Ultima barrera en la base: el plan esta publicado, el estudiante matriculado, el corte existe, la evaluacion no se ha dominado ya (100 %), las preguntas existen, son APROBADAS y son de
--     ESE plan, sin repetidas; el barajado habla solo de preguntas servidas; una sesion nace abierta; lo servido no cambia nunca; cerrar es de un solo sentido y exige un resultado por cada
--     pregunta servida y un puntaje que coincida con esos resultados.
--   - Una sola sesion ABIERTA por estudiante y evaluacion; si la anterior vencio sin cerrarse, se descarta al empezar una nueva.
--   - El cierre es ATOMICO (close_exam_session: escribe el intento y cierra la sesion en una sola transaccion): un fallo a medias no consume un intento sin sesion cerrada. La funcion es
--     SECURITY INVOKER y solo la puede ejecutar service_role.

CREATE TABLE IF NOT EXISTS public.exam_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id  uuid NOT NULL,
  classroom_id  uuid NOT NULL,
  student_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('period', 'final')),
  period_id     text CHECK (period_id IS NULL OR period_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  -- Las preguntas servidas, en el orden en que salieron (5 a 60, como composeExam).
  question_ids  uuid[] NOT NULL CHECK (cardinality(question_ids) BETWEEN 5 AND 60),
  -- Como se barajo cada pregunta: {idDePregunta: {"opts": [..], "defs": [..]}}.
  layout        jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object' AND pg_column_size(layout) < 30000),
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  closed_at     timestamptz,
  -- Al cerrar: {idDePregunta: true|false}, el puntaje y el intento que se escribio.
  results       jsonb CHECK (results IS NULL OR (jsonb_typeof(results) = 'object' AND pg_column_size(results) < 10000)),
  score_percent numeric(5, 2) CHECK (score_percent IS NULL OR (score_percent >= 0 AND score_percent <= 100)),
  attempt_id    uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  CONSTRAINT exam_sessions_blueprint_fk FOREIGN KEY (blueprint_id, classroom_id) REFERENCES public.course_blueprints (id, classroom_id) ON DELETE CASCADE,
  CONSTRAINT exam_sessions_kind_period CHECK ((kind = 'final') = (period_id IS NULL)),
  -- Una sesion dura como mucho 12 horas.
  CONSTRAINT exam_sessions_expiry CHECK (expires_at > started_at AND expires_at <= started_at + interval '12 hours'),
  -- Cerrada <=> tiene resultados y puntaje.
  CONSTRAINT exam_sessions_closed CHECK ((closed_at IS NULL) = (results IS NULL) AND (closed_at IS NULL) = (score_percent IS NULL))
);

-- Una sola sesion abierta por (plan, estudiante, evaluacion). COALESCE: en la final period_id es NULL.
CREATE UNIQUE INDEX IF NOT EXISTS exam_sessions_one_open
  ON public.exam_sessions (blueprint_id, student_id, kind, COALESCE(period_id, ''))
  WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exam_sessions_student ON public.exam_sessions (student_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_blueprint ON public.exam_sessions (blueprint_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_attempt ON public.exam_sessions (attempt_id);

CREATE OR REPLACE FUNCTION public.exam_sessions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  bp record;
  distinct_ids integer;
  good_ids integer;
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
      THEN jsonb_path_exists(bp.doc, '$.periods[*] ? (@.id == $pid)', jsonb_build_object('pid', NEW.period_id))
      ELSE false END
  ) THEN
    RAISE EXCEPTION 'El corte no existe en el plan' USING ERRCODE = '23514';
  END IF;

  -- Una sesion nace abierta y sin resultados.
  IF NEW.closed_at IS NOT NULL OR NEW.results IS NOT NULL OR NEW.score_percent IS NOT NULL OR NEW.attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Una sesion nueva debe nacer abierta' USING ERRCODE = '23514';
  END IF;

  -- Dos inicios simultaneos del mismo estudiante en la misma evaluacion se atienden uno tras otro.
  PERFORM pg_advisory_xact_lock(hashtextextended('exam-session:' || NEW.blueprint_id::text || ':' || NEW.student_id::text || ':' || NEW.kind || ':' || COALESCE(NEW.period_id, ''), 0));

  -- Si ya domino la evaluacion (100 %), no hay mas sesiones.
  IF EXISTS (SELECT 1 FROM public.exam_attempts a WHERE a.blueprint_id = NEW.blueprint_id AND a.student_id = NEW.student_id AND a.kind = NEW.kind AND a.period_id IS NOT DISTINCT FROM NEW.period_id AND a.score_percent >= 100) THEN
    RAISE EXCEPTION 'La evaluacion ya se domino (100 %%): no se repite' USING ERRCODE = '23514';
  END IF;

  -- Una sesion abierta que ya vencio sin cerrarse se descarta: no bloquea una nueva.
  DELETE FROM public.exam_sessions s
   WHERE s.blueprint_id = NEW.blueprint_id AND s.student_id = NEW.student_id AND s.kind = NEW.kind AND s.period_id IS NOT DISTINCT FROM NEW.period_id
     AND s.closed_at IS NULL AND s.expires_at <= now();

  -- Las preguntas: sin repetidas, y TODAS existen, son de ESTE plan y estan aprobadas por el profesor.
  SELECT count(DISTINCT x) INTO distinct_ids FROM unnest(NEW.question_ids) AS x;
  IF distinct_ids <> cardinality(NEW.question_ids) THEN
    RAISE EXCEPTION 'La sesion repite preguntas' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO good_ids FROM public.exam_questions q
   WHERE q.id = ANY (NEW.question_ids) AND q.blueprint_id = NEW.blueprint_id AND q.classroom_id = NEW.classroom_id AND q.review_status = 'approved';
  IF good_ids <> cardinality(NEW.question_ids) THEN
    RAISE EXCEPTION 'Todas las preguntas de la sesion deben existir en el plan y estar aprobadas' USING ERRCODE = '23514';
  END IF;

  -- El barajado solo habla de preguntas servidas.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.layout) AS k WHERE k NOT IN (SELECT x::text FROM unnest(NEW.question_ids) AS x)) THEN
    RAISE EXCEPTION 'El barajado menciona preguntas que no se sirvieron' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_sessions_guard ON public.exam_sessions;
CREATE TRIGGER exam_sessions_guard
  BEFORE INSERT ON public.exam_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.exam_sessions_guard();

-- Lo servido no cambia nunca; cerrar es de un solo sentido y coherente.
CREATE OR REPLACE FUNCTION public.exam_sessions_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  expected numeric;
BEGIN
  IF (NEW.id, NEW.blueprint_id, NEW.classroom_id, NEW.student_id, NEW.kind, NEW.period_id, NEW.question_ids, NEW.layout, NEW.started_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.blueprint_id, OLD.classroom_id, OLD.student_id, OLD.kind, OLD.period_id, OLD.question_ids, OLD.layout, OLD.started_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'Lo que se sirvio en una sesion no se edita' USING ERRCODE = '23514';
  END IF;
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Una sesion cerrada no se modifica' USING ERRCODE = '23514';
  END IF;
  IF NEW.closed_at IS NULL THEN
    RAISE EXCEPTION 'Una sesion abierta solo cambia al cerrarse' USING ERRCODE = '23514';
  END IF;
  IF NEW.attempt_id IS NULL THEN
    RAISE EXCEPTION 'Cerrar una sesion exige el intento que se escribio' USING ERRCODE = '23514';
  END IF;
  -- Un resultado (true/false) por cada pregunta servida, y ninguno mas.
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.results)) <> cardinality(OLD.question_ids)
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.results) AS k WHERE k NOT IN (SELECT x::text FROM unnest(OLD.question_ids) AS x))
     OR EXISTS (SELECT 1 FROM jsonb_each(NEW.results) AS e WHERE jsonb_typeof(e.value) <> 'boolean') THEN
    RAISE EXCEPTION 'Los resultados deben traer un true/false por cada pregunta servida' USING ERRCODE = '23514';
  END IF;
  -- El puntaje es el de esos resultados.
  SELECT round(100.0 * count(*) FILTER (WHERE e.value = 'true'::jsonb) / cardinality(OLD.question_ids), 2) INTO expected FROM jsonb_each(NEW.results) AS e;
  IF NEW.score_percent IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'El puntaje no coincide con los resultados' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_sessions_before_update ON public.exam_sessions;
CREATE TRIGGER exam_sessions_before_update
  BEFORE UPDATE ON public.exam_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.exam_sessions_before_update();

-- Cierre atomico: escribe el intento (su trigger asigna el numero y bloquea repetir tras 100 %) y cierra la sesion. Devuelve el numero de intento.
CREATE OR REPLACE FUNCTION public.close_exam_session(p_session uuid, p_results jsonb, p_score numeric)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  s record;
  a record;
BEGIN
  SELECT * INTO s FROM public.exam_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La sesion no existe' USING ERRCODE = '23514';
  END IF;
  IF s.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'La sesion ya se cerro' USING ERRCODE = '23514';
  END IF;
  IF s.expires_at <= now() THEN
    RAISE EXCEPTION 'La sesion vencio' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.exam_attempts (blueprint_id, classroom_id, student_id, kind, period_id, score_percent)
  VALUES (s.blueprint_id, s.classroom_id, s.student_id, s.kind, s.period_id, p_score)
  RETURNING id, attempt_number INTO a;

  UPDATE public.exam_sessions SET closed_at = now(), results = p_results, score_percent = p_score, attempt_id = a.id WHERE id = p_session;
  RETURN a.attempt_number;
END;
$$;

ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;

-- Profesor dueño de la clase: ve las sesiones de su clase. NINGUNA politica para estudiantes.
DROP POLICY IF EXISTS exam_sessions_teacher_select ON public.exam_sessions;
CREATE POLICY exam_sessions_teacher_select ON public.exam_sessions
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

-- ───────────────────────────── permisos ─────────────────────────────
REVOKE ALL ON TABLE public.exam_sessions FROM anon, authenticated;
GRANT SELECT ON TABLE public.exam_sessions TO authenticated;

REVOKE ALL ON FUNCTION public.exam_sessions_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exam_sessions_before_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_exam_session(uuid, jsonb, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_exam_session(uuid, jsonb, numeric) TO service_role;

COMMENT ON TABLE public.exam_sessions IS 'Un intento de una evaluacion del plan por cortes: que preguntas se sirvieron y como se barajaron; al cerrar, los resultados. Solo la lee el profesor dueño y el servidor; el estudiante nunca la toca directamente.';
