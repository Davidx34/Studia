-- 097: cuaderno de estilo (playbook) por clase (fase 3 de «IA que aprende con cada curso»).
--
-- Un playbook es una lista corta de reglas en lenguaje natural que el PROFESOR revisa y activa, y que los generadores de preguntas leen como parte del prompt
-- («en esta clase, las preguntas de aplicacion deben traer el dato numerico en el enunciado»). No entrena ningun modelo: es conocimiento versionado y reversible.
--
-- Reglas del diseno:
--   - Versionado: cada guardado crea una version nueva (borrador). Activar una la deja 'active' y retira la anterior; volver atras = activar una version vieja.
--   - Una sola version activa por clase (indice unico parcial).
--   - Maximo 10 reglas por version (el prompt no debe crecer sin limite).
--   - origin: 'teacher' (escrito por el profesor) o 'ai' (propuesto por la IA; hoy NADIE lo escribe: se habilitara cuando haya evidencia suficiente, ver docs/IA_APRENDIZAJE_FASE0.md).
--   - RLS: solo el profesor dueno de la clase lee y escribe; el estudiante no ve nada. Los generadores lo leen en el servidor con la llave de servicio.
--
-- Aditiva: no cambia datos existentes. Sin playbook activo, la generacion es identica a la de hoy.
-- Para deshacer: DROP TABLE public.ai_playbooks;

CREATE TABLE IF NOT EXISTS public.ai_playbooks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version >= 1),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  origin       text NOT NULL DEFAULT 'teacher' CHECK (origin IN ('teacher', 'ai')),
  rules        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rules) = 'array' AND jsonb_array_length(rules) <= 10),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE (classroom_id, version)
);

COMMENT ON TABLE public.ai_playbooks IS 'Cuaderno de estilo versionado por clase: reglas [{text, evidence?}] que el profesor activa y los generadores de preguntas leen en el prompt.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_playbooks_active ON public.ai_playbooks (classroom_id) WHERE status = 'active';

ALTER TABLE public.ai_playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_playbooks_teacher ON public.ai_playbooks
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = ai_playbooks.classroom_id AND c.teacher_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = ai_playbooks.classroom_id AND c.teacher_id = (SELECT auth.uid())));

REVOKE ALL ON public.ai_playbooks FROM anon;
