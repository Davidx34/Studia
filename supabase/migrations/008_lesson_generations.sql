-- Migration 008: lesson_generations table (cache TTL 7d)
-- Fase 11.A · Stud.ia
--
-- Cache de outlines generados por el "Stage 1 - Outliner" del flujo
-- generate-lesson-from-material. Evita regenerar outlines mientras
-- el material no haya cambiado y no expire el TTL.
--
-- materials_version_hash es un hash determinista de los IDs+versions
-- de los materiales que alimentaron el outline. Si cambia, el cache
-- se invalida implícitamente (queda huérfano y luego se purga por expires_at).
-- También se invalida explícitamente vía invalidate_lesson_cache(...) (migración 012).
--
-- RLS:
--   "Service role only": FOR ALL USING (false) → bloquea a TODOS los roles
--   excepto al service_role (que bypassea RLS por diseño en Supabase).
--   Esto la convierte en una tabla puramente backend.

CREATE TABLE public.lesson_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.content_modules(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  difficulty_level INTEGER NOT NULL,
  outline JSONB NOT NULL,
  materials_version_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days')
);

CREATE INDEX idx_lesson_gens_module ON public.lesson_generations(module_id);
CREATE INDEX idx_lesson_gens_classroom ON public.lesson_generations(classroom_id);
CREATE INDEX idx_lesson_gens_expires ON public.lesson_generations(expires_at);

ALTER TABLE public.lesson_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.lesson_generations
  FOR ALL USING (false);
