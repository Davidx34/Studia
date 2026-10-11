-- Modo sombra de la calificacion en el servidor (fase 0 del plan docs/PLAN_CALIFICACION_EN_SERVIDOR.md).
--
-- El navegador sigue calificando; /api/lesson/shadow califica en paralelo y deja aqui una fila por respuesta con lo que
-- decidio cada uno. Sirve para medir (consulta de abajo) si el servidor coincide con el navegador ANTES de depender de el.
-- Es una tabla de diagnostico: nadie la lee desde la app (ni estudiantes ni profesores), solo se consulta por SQL.
--
-- Aditiva: no cambia nada existente. Si la tabla no existe, la ruta lo registra y sigue (no afecta la leccion).

CREATE TABLE IF NOT EXISTS public.grading_shadow_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.lesson_questions(id) ON DELETE CASCADE,
  question_type text NOT NULL,
  client_correct boolean NOT NULL,
  server_correct boolean NOT NULL,
  agrees boolean GENERATED ALWAYS AS (client_correct = server_correct) STORED,
  answer jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grading_shadow_log_student ON public.grading_shadow_log (student_id);
CREATE INDEX IF NOT EXISTS idx_grading_shadow_log_question ON public.grading_shadow_log (question_id);
-- Las discrepancias son lo que interesa revisar.
CREATE INDEX IF NOT EXISTS idx_grading_shadow_log_disagreements ON public.grading_shadow_log (created_at DESC) WHERE NOT agrees;

ALTER TABLE public.grading_shadow_log ENABLE ROW LEVEL SECURITY;

-- Solo se puede INSERTAR, y solo filas propias. Sin SELECT/UPDATE/DELETE para nadie desde la app.
REVOKE ALL ON public.grading_shadow_log FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.grading_shadow_log TO authenticated;

CREATE POLICY "students_insert_own_shadow_log"
  ON public.grading_shadow_log FOR INSERT
  TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

-- Para revisar la paridad (ejecutar como administrador):
--   SELECT question_type, count(*) AS total, count(*) FILTER (WHERE agrees) AS coinciden,
--          round(100.0 * count(*) FILTER (WHERE agrees) / count(*), 1) AS pct
--   FROM public.grading_shadow_log GROUP BY 1 ORDER BY 1;
--   SELECT * FROM public.grading_shadow_log WHERE NOT agrees ORDER BY created_at DESC LIMIT 50;
