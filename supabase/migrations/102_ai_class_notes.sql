-- 102: memoria del profesor por clase (nueva memoria de «IA que aprende»; ver docs/IA_ARQUITECTURA_DE_MEMORIAS.md §11).
--
-- Una nota es un dato corto que SOLO el profesor conoce y que la IA no puede deducir del material ni de las estadisticas: «mis estudiantes no han visto calculo diferencial»,
-- «en este curso la nota minima es 3,0», «usamos pesos colombianos en los ejemplos». Las escribe el profesor, las retira cuando ya no valen, y los generadores las leen en el prompt.
-- A diferencia del cuaderno de estilo (reglas sobre COMO redactar), la nota es sobre el CONTEXTO de la clase.
--
-- Las otras dos memorias nuevas (errores comunes por concepto y ejemplos aprobados) NO necesitan tabla: se derivan al leer de lesson_questions
-- (review_reason + concept_tag, y reviewed_by = 'teacher'), que ya es la fuente de verdad; guardarlas aparte las dejaria desincronizadas.
--
-- Seguridad: RLS; solo el profesor dueno de la clase lee y escribe (igual que ai_playbooks). El estudiante no ve nada. Los generadores la leen en el servidor.
-- Aditiva: no cambia datos existentes; sin notas activas la generacion es identica a la de hoy.
-- Para deshacer: DROP TABLE public.ai_class_notes;

CREATE TABLE IF NOT EXISTS public.ai_class_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  text         text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 8 AND 300),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  retired_at   timestamptz
);

COMMENT ON TABLE public.ai_class_notes IS 'Notas de contexto de la clase escritas por el profesor (hasta 300 caracteres); las activas se agregan al prompt de generacion. Maximo 15 activas por clase (lo exige la accion del servidor).';

CREATE INDEX IF NOT EXISTS idx_ai_class_notes_classroom ON public.ai_class_notes (classroom_id, status, created_at);

ALTER TABLE public.ai_class_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_class_notes_teacher ON public.ai_class_notes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = ai_class_notes.classroom_id AND c.teacher_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = ai_class_notes.classroom_id AND c.teacher_id = (SELECT auth.uid())));

REVOKE ALL ON public.ai_class_notes FROM anon;
