-- 103: juez EXTERNO y rondas de mejora iterativa (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §13).
--
-- Contexto: la calibracion del juez de la app depende de decisiones del profesor, que cuestan conseguir. El bucle iterativo agrega un segundo canal: un revisor externo (un modelo fuerte operado
-- por una persona desde una sesion de Claude Code; la app NUNCA lo llama en produccion) revisa y CORRIGE preguntas en lote, y las correcciones se integran al banco con trazabilidad total.
--
-- Esta migracion es ADITIVA:
--   1. lesson_questions.reviewed_by acepta 'external_ai' (antes solo 'ai_judge' y 'teacher').
--   2. ai_feedback_events.signal acepta 'external'; el trigger de eventos mapea reviewed_by='external_ai' -> signal 'external'.
--   3. ai_question_revisions: una fila por CADA pregunta que el revisor externo reviso (veredicto, defectos y antes/despues): permite revertir cualquier correccion y, comparando sus veredictos con las
--      decisiones del profesor, VALIDAR al revisor externo antes de dejarle aprobar nada.
--   4. ai_quality_rounds: una fila por ronda de revision (solo NUMEROS: muestra, buenas, intervalo al 95 %, defectos por codigo). Alimenta la meta «≈ 90 % buenas con IC 95 %».
-- RLS activado SIN politicas (solo servidor con la llave de servicio, igual que ai_feedback_events).
-- Para deshacer: DROP TABLE ai_quality_rounds, ai_question_revisions; restaurar los CHECK y la funcion log_question_review_event de la migracion 096.

ALTER TABLE public.lesson_questions DROP CONSTRAINT IF EXISTS lesson_questions_reviewed_by_check;
ALTER TABLE public.lesson_questions ADD CONSTRAINT lesson_questions_reviewed_by_check CHECK (reviewed_by IS NULL OR reviewed_by IN ('ai_judge', 'teacher', 'external_ai'));

ALTER TABLE public.ai_feedback_events DROP CONSTRAINT IF EXISTS ai_feedback_events_signal_check;
ALTER TABLE public.ai_feedback_events ADD CONSTRAINT ai_feedback_events_signal_check CHECK (signal IN ('judge', 'teacher', 'external', 'unknown'));

CREATE OR REPLACE FUNCTION public.log_question_review_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NEW.review_status IS DISTINCT FROM OLD.review_status OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
    INSERT INTO public.ai_feedback_events (classroom_id, question_id, signal, verdict, previous_verdict, reason)
    SELECT m.classroom_id, NEW.id,
           CASE NEW.reviewed_by WHEN 'ai_judge' THEN 'judge' WHEN 'teacher' THEN 'teacher' WHEN 'external_ai' THEN 'external' ELSE 'unknown' END,
           NEW.review_status, OLD.review_status, NEW.review_reason
    FROM public.content_modules m WHERE m.id = NEW.module_id;
  END IF;
  RETURN NEW;
END
$f$;

REVOKE ALL ON FUNCTION public.log_question_review_event() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.ai_question_revisions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id  uuid REFERENCES public.lesson_questions(id) ON DELETE CASCADE,
  classroom_id uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  source       text NOT NULL DEFAULT 'external_ai' CHECK (source IN ('external_ai', 'teacher')),
  verdict      text NOT NULL CHECK (verdict IN ('bueno', 'corregir', 'malo')),
  batch_id     text,
  before       jsonb NOT NULL,
  after        jsonb NOT NULL,
  defects      jsonb NOT NULL DEFAULT '[]'::jsonb,
  reverted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ai_question_revisions IS 'Una fila por pregunta revisada por el revisor externo: veredicto, defectos y antes/despues (permite revertir y validar al revisor contra el profesor). question_id puede ser NULL si la pregunta (de un lote local) nunca entro al banco. Solo servidor.';
CREATE INDEX IF NOT EXISTS idx_ai_question_revisions_question ON public.ai_question_revisions (question_id, created_at);
ALTER TABLE public.ai_question_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_question_revisions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.ai_quality_rounds (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id    text NOT NULL UNIQUE,
  source      text NOT NULL CHECK (source IN ('external_ai', 'teacher')),
  kind        text NOT NULL CHECK (kind IN ('generated', 'bank')),
  n           integer NOT NULL CHECK (n >= 0),
  good        integer NOT NULL CHECK (good >= 0 AND good <= n),
  ci_low      numeric(5,4),
  ci_high     numeric(5,4),
  defects     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ai_quality_rounds IS 'Una fila por ronda de revision de calidad (solo numeros): muestra, buenas e intervalo de Wilson al 95 %. kind=generated: preguntas recien generadas; kind=bank: preguntas ya servidas. Solo servidor.';
ALTER TABLE public.ai_quality_rounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_quality_rounds FROM anon, authenticated;
