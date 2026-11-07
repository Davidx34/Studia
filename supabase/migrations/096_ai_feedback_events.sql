-- 096: registro de senales de calidad de la IA (fase 1 de «IA que aprende con cada curso»).
--
-- Problema medido en la fase 0 (2026-11-06): lesson_questions.review_status guarda SOLO el ultimo veredicto. Cuando el profesor corrige al juez, el veredicto del juez se pierde
-- (hoy solo sobrevive como texto dentro de review_reason: «[juez actual: fail] ...»). Sin historial no se puede medir cuanto acierta el juez ni calibrarlo.
--
-- Esta migracion es ADITIVA y no cambia el comportamiento del producto:
--   1. ai_feedback_events: registro SOLO DE ANADIR de cada cambio de review_status (quien, que, por que). Lo llena un trigger, asi que captura a TODOS los escritores
--      (juez, profesor, scripts) sin tocar el codigo de la app.
--   2. Respaldo inicial: un evento por cada pregunta que ya tiene veredicto (signal segun reviewed_by; marcado source='backfill').
--   3. question_stats + recompute_question_stats(): estadisticas por pregunta, recalculables (no se editan a mano). Excluye las clases de prueba de carga ([CARGA]...).
--
-- Seguridad: RLS activado SIN politicas (solo el servidor con la llave de servicio, igual que ai_usage_windows); funciones solo para service_role.
-- Para deshacer: DROP TRIGGER trg_lesson_questions_feedback ON lesson_questions; DROP FUNCTION ...; DROP TABLE ai_feedback_events, question_stats.

CREATE TABLE IF NOT EXISTS public.ai_feedback_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  classroom_id  uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  question_id   uuid REFERENCES public.lesson_questions(id) ON DELETE SET NULL,
  signal        text NOT NULL CHECK (signal IN ('judge', 'teacher', 'unknown')),
  verdict       text NOT NULL CHECK (verdict IN ('pending', 'approved', 'rejected', 'human_review')),
  previous_verdict text,
  reason        text,
  source        text NOT NULL DEFAULT 'trigger' CHECK (source IN ('trigger', 'backfill')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_feedback_events IS 'Registro solo de anadir de cambios de review_status de lesson_questions: quien decidio (judge/teacher/unknown), el veredicto nuevo y el anterior. Base para calibrar al juez IA.';

CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_question ON public.ai_feedback_events (question_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_classroom ON public.ai_feedback_events (classroom_id, signal, created_at);

ALTER TABLE public.ai_feedback_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_feedback_events FROM anon, authenticated;

-- Trigger: cada cambio de review_status (o de quien lo decidio) deja un evento.
CREATE OR REPLACE FUNCTION public.log_question_review_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NEW.review_status IS DISTINCT FROM OLD.review_status OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
    INSERT INTO public.ai_feedback_events (classroom_id, question_id, signal, verdict, previous_verdict, reason)
    SELECT m.classroom_id, NEW.id,
           CASE NEW.reviewed_by WHEN 'ai_judge' THEN 'judge' WHEN 'teacher' THEN 'teacher' ELSE 'unknown' END,
           NEW.review_status, OLD.review_status, NEW.review_reason
    FROM public.content_modules m WHERE m.id = NEW.module_id;
  END IF;
  RETURN NEW;
END
$f$;

REVOKE ALL ON FUNCTION public.log_question_review_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lesson_questions_feedback ON public.lesson_questions;
CREATE TRIGGER trg_lesson_questions_feedback
  AFTER UPDATE OF review_status, reviewed_by ON public.lesson_questions
  FOR EACH ROW EXECUTE FUNCTION public.log_question_review_event();

-- Respaldo inicial (idempotente: solo si la tabla esta vacia). Un evento por pregunta con veredicto distinto de 'pending'.
INSERT INTO public.ai_feedback_events (classroom_id, question_id, signal, verdict, reason, source, created_at)
SELECT m.classroom_id, q.id,
       CASE q.reviewed_by WHEN 'ai_judge' THEN 'judge' WHEN 'teacher' THEN 'teacher' ELSE 'unknown' END,
       q.review_status, q.review_reason, 'backfill', coalesce(q.reviewed_at, q.created_at)
FROM public.lesson_questions q
JOIN public.content_modules m ON m.id = q.module_id
WHERE q.review_status <> 'pending'
  AND NOT EXISTS (SELECT 1 FROM public.ai_feedback_events);

-- Estadisticas por pregunta, recalculables.
CREATE TABLE IF NOT EXISTS public.question_stats (
  question_id      uuid PRIMARY KEY REFERENCES public.lesson_questions(id) ON DELETE CASCADE,
  classroom_id     uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  attempts         integer NOT NULL,
  correct          integer NOT NULL,
  correct_rate     numeric(5,4) NOT NULL,
  distinct_students integer NOT NULL,
  last_attempt_at  timestamptz,
  computed_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.question_stats IS 'Dificultad observada por pregunta (aciertos/intentos). Se recalcula con recompute_question_stats(); no se edita a mano. Excluye clases [CARGA]. Con pocos intentos la tasa es ruido: usar attempts como umbral.';

ALTER TABLE public.question_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_stats FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.recompute_question_stats() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.question_stats;
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

REVOKE ALL ON FUNCTION public.recompute_question_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_question_stats() TO service_role;
