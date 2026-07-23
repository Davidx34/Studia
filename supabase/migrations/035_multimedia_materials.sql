-- Migration 035: materiales multimedia (links y videos de YouTube)
-- Fase 11 · Sesion K (alcance reducido) · Stud.ia
--
-- Sesion K original pedia soporte completo de video/audio/links con Google
-- Cloud Speech-to-Text + Firebase Storage + cheerio — nada de eso existe en
-- este proyecto (Supabase + Gemini). Alcance acordado con el usuario:
--   - Links externos: se scrapea el contenido y se procesa como material normal.
--   - Videos de YouTube: se embeben, se intenta obtener transcripcion via
--     captions automaticos de YouTube (best-effort, sin API key).
--   - Audio subido / video subido directo / Vimeo / SoundCloud: fuera de
--     alcance por ahora (necesitarian bucket de video + service nuevo).
--
-- Extension ADITIVA de teaching_materials (no rompe materiales existentes,
-- que quedan con source_type='file' por default).

ALTER TABLE public.teaching_materials
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'file'
    CHECK (source_type IN ('file', 'link', 'youtube')),
  ADD COLUMN IF NOT EXISTS external_url TEXT,
  ADD COLUMN IF NOT EXISTS external_title TEXT,
  ADD COLUMN IF NOT EXISTS external_favicon TEXT,
  ADD COLUMN IF NOT EXISTS youtube_video_id TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS transcript_source TEXT; -- 'youtube_captions' | 'none' (solo youtube)

-- Los materiales de tipo link/youtube no tienen archivo real en Storage.
ALTER TABLE public.teaching_materials ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE public.teaching_materials ALTER COLUMN mime_type DROP NOT NULL;
ALTER TABLE public.teaching_materials ALTER COLUMN size_bytes DROP NOT NULL;
ALTER TABLE public.teaching_materials ALTER COLUMN size_bytes SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_materials_source_type ON public.teaching_materials(source_type);
