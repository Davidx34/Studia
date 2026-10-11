-- Calificacion en el servidor, fase 1 (docs/PLAN_CALIFICACION_EN_SERVIDOR.md).
--
-- lesson_attempts: cada vez que un estudiante abre una leccion con calificacion del servidor se crea un intento que fija
--   QUE preguntas se sirvieron (asi no se pueden calificar preguntas ajenas ni de otro modulo).
-- lesson_attempt_answers: una fila por pregunta e intento, con cuantas veces se intento y el resultado. Es lo que hace que
--   repetir una respuesta no sume y que los intentos por pregunta (completar 2, emparejar 3) los cuente el servidor.
--
-- Solo las escribe/lee el servidor con la llave de servicio (la RLS esta activa y no hay NINGUN permiso para anon ni
-- authenticated): el estudiante no puede ver ni fabricar intentos. Aditiva: no cambia nada existente.

CREATE TABLE IF NOT EXISTS public.lesson_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.content_modules(id) ON DELETE CASCADE,
  question_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'finished')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.lesson_attempt_answers (
  attempt_id uuid NOT NULL REFERENCES public.lesson_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.lesson_questions(id) ON DELETE CASCADE,
  tries integer NOT NULL DEFAULT 0 CHECK (tries >= 0),
  correct boolean,
  final boolean NOT NULL DEFAULT false,
  answer jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_attempts_student ON public.lesson_attempts (student_id);
CREATE INDEX IF NOT EXISTS idx_lesson_attempts_module ON public.lesson_attempts (module_id);
CREATE INDEX IF NOT EXISTS idx_lesson_attempt_answers_question ON public.lesson_attempt_answers (question_id);

ALTER TABLE public.lesson_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_attempt_answers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lesson_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lesson_attempt_answers FROM PUBLIC, anon, authenticated;
