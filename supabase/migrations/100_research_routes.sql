-- 100: rutas de investigacion (fase 5 de «IA que aprende con cada curso»).
--
-- El profesor pide una ruta sobre un tema; Gemini busca en la web con Google Search y devuelve lecturas, preguntas guia y un estilo de pregunta recomendado, CON fuentes citadas.
-- Reglas: las fuentes son SUGERENCIAS, no material del curso (no entran al RAG); lo que no tiene fuente no se presenta como hecho; solo se guarda una ruta si la busqueda devolvio fuentes.
--   sources: [{ n, title, url|null, reach: 'ok'|'broken'|'unchecked' }]  (reach = lo que SE COMPROBO al resolver el enlace, no una garantia del contenido)
--   cited_ratio: fraccion del texto que Gemini respalda con una fuente (0 a 1).
-- RLS: solo el profesor dueno de la clase. Aditiva. Para deshacer: DROP TABLE public.research_routes;

CREATE TABLE IF NOT EXISTS public.research_routes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  topic        text NOT NULL CHECK (length(btrim(topic)) BETWEEN 3 AND 120),
  answer       text NOT NULL CHECK (length(answer) BETWEEN 1 AND 12000),
  sources      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) <= 12),
  queries      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(queries) = 'array'),
  cited_ratio  numeric(3,2) NOT NULL DEFAULT 0 CHECK (cited_ratio BETWEEN 0 AND 1),
  model        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.research_routes IS 'Rutas de investigacion sugeridas por IA con busqueda web y fuentes citadas. Sugerencias del profesor: no son material del curso ni entran al RAG.';

CREATE INDEX IF NOT EXISTS idx_research_routes_classroom ON public.research_routes (classroom_id, created_at DESC);

ALTER TABLE public.research_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY research_routes_teacher ON public.research_routes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = research_routes.classroom_id AND c.teacher_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = research_routes.classroom_id AND c.teacher_id = (SELECT auth.uid())));

REVOKE ALL ON public.research_routes FROM anon;
