-- 082: entregas de laboratorio (el informe que el estudiante entrega al terminar un laboratorio publicado).
--
-- Un estudiante abre un laboratorio PUBLICADO de su clase, hace sus ensayos y entrega: hipotesis, ensayos, respuestas a las preguntas guia y conclusion. El profesor dueño de la
-- clase lo revisa (nota y comentario).
--
-- Seguridad (la tabla guarda lo que escribe un estudiante, asi que se trata como no confiable):
--   - El estudiante NO inserta directo. La entrega pasa por POST /api/lab/attempt, que valida en el servidor (src/lib/lab/submission.ts: minimo de ensayos, ensayo de control primero,
--     respuestas a las preguntas guia y COHERENCIA NUMERICA: cada ensayo se vuelve a calcular con el modelo, de modo que nadie falsifica la tabla por la consola del navegador) y
--     recien entonces inserta con la llave de servicio. Por eso anon y authenticated NO tienen INSERT: una politica de INSERT dejaria saltarse el validador con la llave publica.
--   - SELECT: el estudiante ve solo SUS entregas; el profesor dueño de la clase ve las de su clase.
--   - UPDATE: solo el profesor dueño, y solo las columnas de revision (nota, comentario y estado) por permiso de columna: no puede reescribir lo que entrego el estudiante.
--   - Una entrega por estudiante y laboratorio (UNIQUE). Las entregas se borran si se borra el laboratorio, el estudiante o la clase.
--   - CHECK en la base de los minimos y maximos (hipotesis >= 10, conclusion >= 20 caracteres, tamaños de los json) como ultima barrera.

CREATE TABLE IF NOT EXISTS public.lab_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id           uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  classroom_id     uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  hypothesis       text NOT NULL CHECK (char_length(hypothesis) BETWEEN 10 AND 2000),
  trials           jsonb NOT NULL CHECK (jsonb_typeof(trials) = 'array' AND pg_column_size(trials) < 65536),
  answers          jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'array' AND pg_column_size(answers) < 16384),
  conclusion       text NOT NULL CHECK (char_length(conclusion) BETWEEN 20 AND 2000),
  status           text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed')),
  teacher_feedback text CHECK (teacher_feedback IS NULL OR char_length(teacher_feedback) <= 2000),
  score            numeric(5, 2) CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lab_attempts_one_per_student UNIQUE (lab_id, student_id),
  -- Una entrega "revisada" tiene nota; una sin revisar no.
  CONSTRAINT lab_attempts_review_consistent CHECK ((status = 'reviewed') = (score IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_lab_attempts_lab ON public.lab_attempts (lab_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_attempts_classroom ON public.lab_attempts (classroom_id, student_id);

DROP TRIGGER IF EXISTS lab_attempts_updated_at ON public.lab_attempts;
CREATE TRIGGER lab_attempts_updated_at
  BEFORE UPDATE ON public.lab_attempts
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

ALTER TABLE public.lab_attempts ENABLE ROW LEVEL SECURITY;

-- Estudiante: solo lee las suyas.
DROP POLICY IF EXISTS lab_attempts_student_select ON public.lab_attempts;
CREATE POLICY lab_attempts_student_select ON public.lab_attempts
  FOR SELECT USING (student_id = auth.uid());

-- Profesor dueño de la clase: lee las de su clase.
DROP POLICY IF EXISTS lab_attempts_teacher_select ON public.lab_attempts;
CREATE POLICY lab_attempts_teacher_select ON public.lab_attempts
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

-- Profesor dueño de la clase: revisa (UPDATE). Las columnas que puede tocar se limitan abajo con permisos de columna.
DROP POLICY IF EXISTS lab_attempts_teacher_update ON public.lab_attempts;
CREATE POLICY lab_attempts_teacher_update ON public.lab_attempts
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

-- Permisos: nadie escribe directo salvo el profesor, y solo la revision. (service_role ignora RLS y conserva todo: es quien inserta la entrega ya validada.)
REVOKE ALL ON TABLE public.lab_attempts FROM anon, authenticated;
GRANT SELECT ON TABLE public.lab_attempts TO authenticated;
GRANT UPDATE (status, score, teacher_feedback) ON TABLE public.lab_attempts TO authenticated;

COMMENT ON TABLE public.lab_attempts IS 'Entregas (informes) de los estudiantes en los laboratorios publicados. Se insertan SOLO desde el servidor, ya validadas (incluida la coherencia numerica); el profesor las revisa.';
