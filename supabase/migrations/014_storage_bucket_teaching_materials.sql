-- Migration 014: storage bucket teaching-materials + 4 access policies
-- Fase 11.A · Stud.ia
--
-- Crea el bucket privado donde se sube el material didáctico.
-- Convención de paths: {classroom_id}/{material_id}_{filename}
--   → (storage.foldername(name))[1] devuelve el classroom_id como texto
--
-- Restricciones:
--   - Privado (public=false), URLs solo via signed URLs
--   - Tamaño máximo: 10 MB por archivo (10485760 bytes)
--   - MIME types permitidos: PDF, DOCX, XLSX, DOC, XLS
--
-- Políticas RLS sobre storage.objects:
--   1. Teachers INSERT: solo si la primera carpeta del path es una classroom suya
--   2. Teachers SELECT: solo en classrooms suyas
--   3. Students SELECT: solo en classrooms donde estén inscritos
--   4. Teachers DELETE: solo en classrooms suyas
--
-- Nota: los 4 nombres de policy son únicos sobre storage.objects.
-- Si en algún momento esta migración se reaplicara y existieran ya,
-- habría que correr DROP POLICY IF EXISTS antes (no se hace ahora porque
-- es la primera vez que se crean).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'teaching-materials',
  'teaching-materials',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.ms-excel'
  ]
);

CREATE POLICY "Teachers upload to own classes" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'teaching-materials' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.classrooms WHERE teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers read own materials" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'teaching-materials' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.classrooms WHERE teacher_id = auth.uid()
    )
  );

CREATE POLICY "Students read class materials" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'teaching-materials' AND
    (storage.foldername(name))[1] IN (
      SELECT classroom_id::text FROM public.class_enrollments WHERE student_id = auth.uid()
    )
  );

CREATE POLICY "Teachers delete own materials" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'teaching-materials' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.classrooms WHERE teacher_id = auth.uid()
    )
  );
