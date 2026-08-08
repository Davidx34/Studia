-- Migration 041: añade flag de generación en progreso a content_modules
-- Fase 2 · Protocolo 7.7.3 · Stud.ia
--
-- Cache stampede: cuando varios estudiantes topan un módulo con pool bajo
-- simultáneamente, todos disparan una generación a Cohere. Con este flag
-- y un patrón de lock optimista, solo una generación entra mientras las
-- demás esperan/utilizan caché.
--
-- Patrón de lock:
-- UPDATE content_modules SET is_generating = true
-- WHERE id = module_id AND is_generating = false
-- Si UPDATE devuelve 0 filas: ya hay generación en curso, 202 Accepted
-- Si UPDATE devuelve 1 fila: generar; al terminar, UPDATE is_generating = false

ALTER TABLE public.content_modules ADD COLUMN IF NOT EXISTS is_generating boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_content_modules_is_generating ON public.content_modules(learning_objective_id) WHERE is_generating = true;
