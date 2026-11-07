-- 098: ciclos de curso y retrospectivas (fase 4 de «IA que aprende con cada curso»).
--
-- Cuando el profesor cierra un ciclo (p. ej. 2027-I), se guarda:
--   - course_cycles: el periodo cerrado y una INSTANTANEA de metricas (solo conteos, tasas e ids de preguntas: sin identificadores de estudiantes ni texto de preguntas).
--   - cycle_retrospectives: hallazgos (cada uno con su dato y tamano de muestra) y sugerencias con estado (pending/accepted/rejected/postponed) que el profesor resuelve.
-- El «ciclo abierto» es implicito: empieza donde termino el ultimo ciclo cerrado (o en la creacion de la clase). Por eso solo se guardan ciclos CERRADOS.
-- Los hallazgos los calcula codigo con reglas (src/lib/aiLearning/retrospective.ts), no un LLM: con muestras pequenas dicen «no hay datos suficientes» en vez de concluir.
--
-- RLS: solo el profesor dueno de la clase lee y escribe; el estudiante no ve nada. Aditiva: no cambia datos existentes.
-- Para deshacer: DROP TABLE public.cycle_retrospectives, public.course_cycles;

CREATE TABLE IF NOT EXISTS public.course_cycles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL CHECK (period_end >= period_start),
  snapshot     jsonb NOT NULL,
  closed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (classroom_id, period_end)
);

CREATE TABLE IF NOT EXISTS public.cycle_retrospectives (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id     uuid NOT NULL UNIQUE REFERENCES public.course_cycles(id) ON DELETE CASCADE,
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  findings     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array'),
  suggestions  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(suggestions) = 'array'),
  generated_by text NOT NULL DEFAULT 'rules-v1',
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.course_cycles IS 'Ciclos de curso CERRADOS con instantanea de metricas agregadas (sin datos individuales).';
COMMENT ON TABLE public.cycle_retrospectives IS 'Hallazgos con evidencia y sugerencias con estado de un ciclo cerrado. generated_by identifica la version de las reglas.';

CREATE INDEX IF NOT EXISTS idx_cycle_retrospectives_classroom ON public.cycle_retrospectives (classroom_id);

ALTER TABLE public.course_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_retrospectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY course_cycles_teacher ON public.course_cycles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = course_cycles.classroom_id AND c.teacher_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = course_cycles.classroom_id AND c.teacher_id = (SELECT auth.uid())));

CREATE POLICY cycle_retrospectives_teacher ON public.cycle_retrospectives
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = cycle_retrospectives.classroom_id AND c.teacher_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = cycle_retrospectives.classroom_id AND c.teacher_id = (SELECT auth.uid())));

REVOKE ALL ON public.course_cycles FROM anon;
REVOKE ALL ON public.cycle_retrospectives FROM anon;
