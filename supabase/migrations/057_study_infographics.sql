-- Paso 5: infografias dibujadas desde DATOS estructurados (no imagenes).
--
-- La IA extrae del material una estructura (cronologia, comparativa, proceso o cifras clave) y la aplicacion la
-- dibuja con HTML/CSS: sin costo de generacion de imagenes, con tema claro/oscuro, accesible y sin pesar en
-- Storage. Se guardan en study_cards (mismo RLS: lectura de inscritos, escritura solo del servidor) con
-- kind = 'infografia': front = titulo, back = tipo legible, extra = { tipo, ...datos }.

ALTER TABLE public.study_cards DROP CONSTRAINT IF EXISTS study_cards_kind_check;
ALTER TABLE public.study_cards ADD CONSTRAINT study_cards_kind_check CHECK (kind IN ('ficha', 'flashcard', 'infografia'));

-- Las infografias se generan aparte de las fichas (otra llamada, otro boton), con su propio estado.
CREATE TABLE IF NOT EXISTS public.study_infographic_generation (
  material_id UUID PRIMARY KEY REFERENCES public.teaching_materials(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  card_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

ALTER TABLE public.study_infographic_generation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver estado de infografias de mis clases" ON public.study_infographic_generation
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.teaching_materials tm
      WHERE tm.id = study_infographic_generation.material_id
        AND (
          tm.teacher_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = tm.classroom_id AND ce.student_id = auth.uid())
        )
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.study_infographic_generation FROM anon, authenticated;
REVOKE ALL ON public.study_infographic_generation FROM anon;
