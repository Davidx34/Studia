-- Migration 006: material_chunks table (RAG storage)
-- Fase 11.A · Stud.ia
--
-- Almacena el texto de cada material partido en chunks semánticos
-- con su embedding vectorial (Gemini text-embedding-004, 768 dims).
-- Es la fuente del RAG que alimenta la generación de lecciones.
--
-- Chunking esperado: ~500 tokens, overlap 50, respeta párrafos.
--
-- Index estrategia:
--   - btree por material_id para listar chunks de un material
--   - HNSW (m=16, ef_construction=64) sobre embedding con vector_cosine_ops
--     para búsqueda de similitud aproximada
--
-- RLS:
--   - Profesor: SELECT en chunks de sus materiales
--   - Estudiante: SELECT en chunks de materiales de sus clases inscritas
--   - INSERT/UPDATE/DELETE solo via service_role (Edge Function process-material)

CREATE TABLE public.material_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES public.teaching_materials(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_tokens INTEGER,
  embedding vector(768),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(material_id, chunk_index)
);

CREATE INDEX idx_chunks_material ON public.material_chunks(material_id);

CREATE INDEX idx_chunks_embedding ON public.material_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.material_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers see chunks of own materials" ON public.material_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.teaching_materials tm
      WHERE tm.id = material_chunks.material_id
        AND tm.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Students see chunks of their class materials" ON public.material_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.teaching_materials tm
      JOIN public.class_enrollments ce ON ce.classroom_id = tm.classroom_id
      WHERE tm.id = material_chunks.material_id
        AND ce.student_id = auth.uid()
    )
  );
