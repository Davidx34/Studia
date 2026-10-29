-- 079: memoria de la clase (lo que la IA "sabe" de la materia segun los materiales cargados).
--
-- Se arma en dos niveles para poder actualizarla de forma incremental y barata:
--   class_memory_material: lo extraido de UN material (conceptos, variables, formulas, leyes, objetivos y sus relaciones) y el HASH de su contenido. Si el material no cambio
--     (mismo hash) no se vuelve a llamar a la IA. Si se borra el material, su fila se borra en cascada.
--   class_memory: el GRAFO de la clase = fusion de todos los materiales listos (src/lib/memory/merge.ts), con version y estado del trabajo en segundo plano.
--
-- Seguridad: es conocimiento del profesor. Solo el profesor dueño de la clase puede LEERLO; nadie escribe desde el navegador (no hay politicas de escritura): lo escribe el
-- servidor con la llave de servicio, despues de comprobar que quien lo pide es el dueño. Los estudiantes no tienen acceso. El contenido es DATO validado y limpiado al extraerlo.

CREATE TABLE IF NOT EXISTS public.class_memory (
  classroom_id uuid PRIMARY KEY REFERENCES public.classrooms(id) ON DELETE CASCADE,
  -- Sube cada vez que se reconstruye: quien lea sabe si la memoria cambio.
  version      integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  status       text NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'ready', 'failed')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  built_at     timestamptz,
  -- Motivo del fallo, o aviso si quedo incompleta (por ejemplo un material no se pudo leer).
  error        text,
  graph        jsonb NOT NULL DEFAULT '{"concepts":[],"edges":[]}'::jsonb CHECK (jsonb_typeof(graph) = 'object' AND pg_column_size(graph) < 800000),
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(stats) = 'object' AND pg_column_size(stats) < 4000),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_memory_material (
  material_id  uuid PRIMARY KEY REFERENCES public.teaching_materials(id) ON DELETE CASCADE,
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'extracting' CHECK (status IN ('extracting', 'ready', 'failed')),
  -- Hash del contenido (todos los fragmentos): si no cambia, no se vuelve a extraer.
  content_hash text NOT NULL CHECK (char_length(content_hash) BETWEEN 8 AND 128),
  extraction   jsonb NOT NULL DEFAULT '{"concepts":[],"edges":[]}'::jsonb CHECK (jsonb_typeof(extraction) = 'object' AND pg_column_size(extraction) < 400000),
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(stats) = 'object' AND pg_column_size(stats) < 4000),
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_memory_material_classroom ON public.class_memory_material (classroom_id, status);

DROP TRIGGER IF EXISTS class_memory_updated_at ON public.class_memory;
CREATE TRIGGER class_memory_updated_at BEFORE UPDATE ON public.class_memory FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();
DROP TRIGGER IF EXISTS class_memory_material_updated_at ON public.class_memory_material;
CREATE TRIGGER class_memory_material_updated_at BEFORE UPDATE ON public.class_memory_material FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at();

ALTER TABLE public.class_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_memory_material ENABLE ROW LEVEL SECURITY;

-- Solo lectura, solo del profesor dueño. Sin politicas de escritura: ni el profesor ni un estudiante pueden escribir desde el navegador.
DROP POLICY IF EXISTS class_memory_teacher_select ON public.class_memory;
CREATE POLICY class_memory_teacher_select ON public.class_memory
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

DROP POLICY IF EXISTS class_memory_material_teacher_select ON public.class_memory_material;
CREATE POLICY class_memory_material_teacher_select ON public.class_memory_material
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

COMMENT ON TABLE public.class_memory IS 'Memoria de la clase: grafo de conceptos fusionado de todos los materiales. Lo escribe solo el servidor.';
COMMENT ON TABLE public.class_memory_material IS 'Lo extraido de un material y el hash de su contenido (actualizacion incremental). Lo escribe solo el servidor.';
