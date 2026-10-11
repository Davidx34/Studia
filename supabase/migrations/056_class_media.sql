-- Paso 4: imagenes y videos (generados por el profesor con Flow/Gemini u otra herramienta) importados a una clase.
--
-- Importacion MANUAL: el profesor sube el archivo; no hay generacion automatica ni costo de IA. El plan gratuito de
-- Supabase da 1 GB de almacenamiento y 5 GB de salida al mes, asi que hay topes (ver src/lib/media/mediaGuards.ts):
-- imagenes ya comprimidas desde el navegador, videos cortos, un maximo por clase.
--
-- Bucket PRIVADO: el estudiante recibe URLs firmadas de corta duracion.
-- Ruta: {classroom_id}/{archivo}  ->  (storage.foldername(name))[1] = classroom_id

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'class-media',
  'class-media',
  false,
  10485760, -- 10 MB por archivo (el tope por tipo lo aplica la aplicacion: 1 MB imagen, 10 MB video)
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.class_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  -- Opcional: si se borra o regenera el modulo, el medio sigue en la clase (queda sin modulo).
  module_id UUID REFERENCES public.content_modules(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  -- Texto alternativo: obligatorio en imagenes (accesibilidad); en video describe lo que se ve.
  alt_text TEXT NOT NULL CHECK (char_length(alt_text) BETWEEN 3 AND 300),
  caption TEXT CHECK (caption IS NULL OR char_length(caption) <= 300),
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_media_classroom ON public.class_media(classroom_id, position);
CREATE INDEX IF NOT EXISTS idx_class_media_module ON public.class_media(module_id) WHERE module_id IS NOT NULL;

ALTER TABLE public.class_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver medios de mis clases" ON public.class_media
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = class_media.classroom_id AND c.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = class_media.classroom_id AND ce.student_id = auth.uid())
  );

-- Solo el profesor dueño de la clase crea, edita o borra, y el modulo enlazado debe ser de ESA clase.
CREATE POLICY "Profesor sube medios a su clase" ON public.class_media
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid())
    AND (module_id IS NULL OR EXISTS (SELECT 1 FROM public.content_modules m WHERE m.id = module_id AND m.classroom_id = class_media.classroom_id))
  );

CREATE POLICY "Profesor edita medios de su clase" ON public.class_media
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid())
    AND (module_id IS NULL OR EXISTS (SELECT 1 FROM public.content_modules m WHERE m.id = module_id AND m.classroom_id = class_media.classroom_id))
  );

CREATE POLICY "Profesor borra medios de su clase" ON public.class_media
  FOR DELETE USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid()));

REVOKE ALL ON public.class_media FROM anon;

-- Storage: el profesor sube/borra en carpetas de SUS clases; los inscritos leen.
CREATE POLICY "Profesor sube a class-media de su clase" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'class-media'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.classrooms WHERE teacher_id = auth.uid())
  );

CREATE POLICY "Profesor lee class-media de su clase" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'class-media'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.classrooms WHERE teacher_id = auth.uid())
  );

CREATE POLICY "Estudiantes leen class-media de su clase" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'class-media'
    AND (storage.foldername(name))[1] IN (SELECT classroom_id::text FROM public.class_enrollments WHERE student_id = auth.uid())
  );

CREATE POLICY "Profesor borra class-media de su clase" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'class-media'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.classrooms WHERE teacher_id = auth.uid())
  );
