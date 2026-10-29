-- 078: laboratorios de una clase (experimentos en ambiente controlado).
--
-- Un laboratorio guarda la FICHA DEL EXPERIMENTO (spec) sobre una plantilla del catalogo (src/lib/lab/labTemplates.ts). Es solo configuracion: variables, rangos, constantes y
-- preguntas, ya validada y recortada a los limites de la plantilla; no contiene codigo. El profesor lo crea y lo publica; los estudiantes de la clase solo ven los publicados.
-- (Los informes de los estudiantes llegan en otra migracion.)
--
-- Seguridad: el spec se vuelve a validar en la app cada vez que se lee (nunca se confia en lo guardado), y estas politicas limitan quien puede ver y escribir:
--   - el profesor dueño de la clase: ver y gestionar todos sus laboratorios (borradores y publicados);
--   - los estudiantes inscritos: ver SOLO los publicados de su clase, sin poder escribir.

CREATE TABLE IF NOT EXISTS public.labs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id       uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  teacher_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  -- Id de la plantilla (la forma, no una lista cerrada: agregar plantillas no necesita migracion).
  template           text NOT NULL CHECK (template ~ '^[a-z][a-z0-9-]{0,31}$'),
  spec               jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object' AND pg_column_size(spec) < 20000),
  -- Material del que salio la idea (opcional; si se borra el material, el laboratorio se queda).
  source_material_id uuid REFERENCES public.teaching_materials(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  published_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_labs_classroom ON public.labs (classroom_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS labs_updated_at ON public.labs;
CREATE TRIGGER labs_updated_at
  BEFORE UPDATE ON public.labs
  FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;

-- Profesor: ve los de sus clases.
DROP POLICY IF EXISTS labs_teacher_select ON public.labs;
CREATE POLICY labs_teacher_select ON public.labs
  FOR SELECT USING (
    teacher_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid())
  );

-- Profesor: crea solo en SUS clases y a su nombre (no puede crear en la clase de otro ni a nombre de otro), y solo desde SUS materiales.
DROP POLICY IF EXISTS labs_teacher_insert ON public.labs;
CREATE POLICY labs_teacher_insert ON public.labs
  FOR INSERT WITH CHECK (
    teacher_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('teacher', 'admin'))
    AND (source_material_id IS NULL OR EXISTS (SELECT 1 FROM public.teaching_materials m WHERE m.id = source_material_id AND m.teacher_id = auth.uid()))
  );

-- Profesor: edita los suyos y no puede mudarlos a otra clase ni cambiar de dueño.
DROP POLICY IF EXISTS labs_teacher_update ON public.labs;
CREATE POLICY labs_teacher_update ON public.labs
  FOR UPDATE USING (teacher_id = auth.uid())
  WITH CHECK (
    teacher_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid())
    AND (source_material_id IS NULL OR EXISTS (SELECT 1 FROM public.teaching_materials m WHERE m.id = source_material_id AND m.teacher_id = auth.uid()))
  );

DROP POLICY IF EXISTS labs_teacher_delete ON public.labs;
CREATE POLICY labs_teacher_delete ON public.labs
  FOR DELETE USING (teacher_id = auth.uid());

-- Estudiantes inscritos: solo los PUBLICADOS de sus clases, y solo lectura.
DROP POLICY IF EXISTS labs_student_select ON public.labs;
CREATE POLICY labs_student_select ON public.labs
  FOR SELECT USING (
    status = 'published'
    AND classroom_id IN (SELECT e.classroom_id FROM public.class_enrollments e WHERE e.student_id = auth.uid())
  );

COMMENT ON TABLE public.labs IS 'Laboratorios (experimentos en ambiente controlado) de una clase: la ficha del experimento sobre una plantilla del catalogo. Solo configuracion, sin codigo.';
