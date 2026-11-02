-- 087: enlace entre los modulos del plan por cortes y los modulos reales de la clase (docs/PLAN_POR_CORTES.md).
--
-- El plan (course_blueprints.doc) habla de modulos "de papel": un id y un titulo. Los estudiantes trabajan con content_modules (lecciones con preguntas y progreso). Esta tabla es el PUENTE:
-- un nodo-modulo del plan <-> un content_module de LA MISMA clase. ADITIVA: no toca ninguna tabla existente ni crea, cambia o borra modulos reales; una clase sin plan, o un plan sin enlaces,
-- funciona exactamente como hoy. Un modulo del plan sin enlace es "pendiente de contenido".
--
-- Seguridad (todo lo que llega del navegador es no confiable):
--   - NADIE escribe desde el navegador (anon y authenticated solo tienen SELECT): el servidor escribe despues de comprobar que quien pide es el profesor dueño de la clase.
--   - SELECT: el profesor dueño ve los enlaces de su clase; el estudiante, solo los de planes PUBLICADOS de clases donde esta matriculado.
--   - Ultima barrera en la base: el modulo real tiene que ser de la MISMA clase que el plan, el nodo tiene que EXISTIR en el documento del plan, un plan archivado no cambia de enlaces,
--     un nodo apunta a un solo modulo real y un modulo real sirve a un solo nodo del mismo plan.

CREATE TABLE IF NOT EXISTS public.blueprint_module_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id      uuid NOT NULL,
  classroom_id      uuid NOT NULL,
  -- Id del modulo dentro del documento del plan (mismo formato que parseBlueprint).
  node_id           text NOT NULL CHECK (node_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  content_module_id uuid NOT NULL REFERENCES public.content_modules(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blueprint_module_links_blueprint_fk FOREIGN KEY (blueprint_id, classroom_id) REFERENCES public.course_blueprints (id, classroom_id) ON DELETE CASCADE,
  CONSTRAINT blueprint_module_links_one_per_node UNIQUE (blueprint_id, node_id),
  CONSTRAINT blueprint_module_links_one_per_module UNIQUE (blueprint_id, content_module_id)
);

CREATE INDEX IF NOT EXISTS idx_blueprint_module_links_module ON public.blueprint_module_links (content_module_id);
CREATE INDEX IF NOT EXISTS idx_blueprint_module_links_classroom ON public.blueprint_module_links (classroom_id);

CREATE OR REPLACE FUNCTION public.blueprint_module_links_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  bp record;
  module_class uuid;
BEGIN
  SELECT status, doc INTO bp FROM public.course_blueprints WHERE id = NEW.blueprint_id AND classroom_id = NEW.classroom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El plan no existe en esa clase' USING ERRCODE = '23514';
  END IF;
  IF bp.status = 'archived' THEN
    RAISE EXCEPTION 'Un plan archivado no cambia de enlaces' USING ERRCODE = '23514';
  END IF;

  -- El modulo real es de la MISMA clase que el plan.
  SELECT classroom_id INTO module_class FROM public.content_modules WHERE id = NEW.content_module_id;
  IF module_class IS DISTINCT FROM NEW.classroom_id THEN
    RAISE EXCEPTION 'El modulo no pertenece a la clase del plan' USING ERRCODE = '23514';
  END IF;

  -- El nodo existe como MODULO en el documento del plan.
  IF NOT (
    CASE WHEN jsonb_typeof(bp.doc -> 'periods') = 'array'
      THEN jsonb_path_exists(bp.doc, '$.periods[*].objectives[*].modules[*] ? (@.id == $nid)', jsonb_build_object('nid', NEW.node_id))
      ELSE false END
  ) THEN
    RAISE EXCEPTION 'El modulo no existe en el plan' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS blueprint_module_links_guard ON public.blueprint_module_links;
CREATE TRIGGER blueprint_module_links_guard
  BEFORE INSERT ON public.blueprint_module_links
  FOR EACH ROW EXECUTE PROCEDURE public.blueprint_module_links_guard();

-- Un enlace no se edita: se borra y se crea otro (asi la guardia de arriba siempre corre).
CREATE OR REPLACE FUNCTION public.blueprint_module_links_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Un enlace no se modifica: borralo y crea otro' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS blueprint_module_links_immutable ON public.blueprint_module_links;
CREATE TRIGGER blueprint_module_links_immutable
  BEFORE UPDATE ON public.blueprint_module_links
  FOR EACH ROW EXECUTE PROCEDURE public.blueprint_module_links_immutable();

ALTER TABLE public.blueprint_module_links ENABLE ROW LEVEL SECURITY;

-- Profesor dueño de la clase: ve los enlaces de su clase.
DROP POLICY IF EXISTS blueprint_module_links_teacher_select ON public.blueprint_module_links;
CREATE POLICY blueprint_module_links_teacher_select ON public.blueprint_module_links
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

-- Estudiante: solo los de un plan PUBLICADO de una clase donde esta matriculado.
DROP POLICY IF EXISTS blueprint_module_links_student_select ON public.blueprint_module_links;
CREATE POLICY blueprint_module_links_student_select ON public.blueprint_module_links
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.course_blueprints b WHERE b.id = blueprint_id AND b.status = 'published')
    AND EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = blueprint_module_links.classroom_id AND ce.student_id = auth.uid())
  );

-- ───────────────────────────── permisos ─────────────────────────────
-- Solo lectura desde el navegador. (service_role ignora RLS: es quien escribe los enlaces ya comprobados.)
REVOKE ALL ON TABLE public.blueprint_module_links FROM anon, authenticated;
GRANT SELECT ON TABLE public.blueprint_module_links TO authenticated;

REVOKE ALL ON FUNCTION public.blueprint_module_links_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.blueprint_module_links_immutable() FROM PUBLIC;

COMMENT ON TABLE public.blueprint_module_links IS 'Puente entre un modulo del plan por cortes (node_id en el documento) y un modulo real de la misma clase (content_modules). Aditiva: sin enlaces, todo funciona como antes. Lo escribe SOLO el servidor.';
