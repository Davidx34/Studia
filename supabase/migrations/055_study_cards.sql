-- Fichas de lectura y flashcards generadas automaticamente desde el material (paso 3 del plan).
--
-- Sin aprobacion del profesor: la IA las genera una vez por material y todos los estudiantes inscritos las ven.
-- Escritura de tarjetas y del estado de generacion: SOLO el servidor (service role). El estudiante solo lee las
-- tarjetas y escribe SU propio avance de repaso (cajas de Leitner). No hay XP ni monedas aqui, asi que el avance
-- puede escribirlo el propio estudiante sin riesgo para la economia del juego.

CREATE TABLE IF NOT EXISTS public.study_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES public.teaching_materials(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ficha', 'flashcard')),
  section TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  -- flashcard: front = pregunta, back = respuesta. ficha: front = titulo, back = idea principal.
  front TEXT NOT NULL CHECK (char_length(front) BETWEEN 3 AND 400),
  back TEXT NOT NULL CHECK (char_length(back) BETWEEN 3 AND 1200),
  -- ficha: { puntos_clave: string[], terminos: {termino, definicion}[], reflexion: string }
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_study_cards_material ON public.study_cards(material_id, kind, position);

CREATE TABLE IF NOT EXISTS public.study_card_generation (
  material_id UUID PRIMARY KEY REFERENCES public.teaching_materials(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  card_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS public.student_card_state (
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.study_cards(id) ON DELETE CASCADE,
  box SMALLINT NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviews INTEGER NOT NULL DEFAULT 0 CHECK (reviews >= 0),
  lapses INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  last_reviewed_at TIMESTAMPTZ,
  PRIMARY KEY (student_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_student_card_state_due ON public.student_card_state(student_id, due_at);

ALTER TABLE public.study_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_card_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_card_state ENABLE ROW LEVEL SECURITY;

-- Lectura: estudiantes inscritos en la clase del material, o el profesor dueño.
CREATE POLICY "Ver tarjetas de mis clases" ON public.study_cards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.teaching_materials tm
      WHERE tm.id = study_cards.material_id
        AND (
          tm.teacher_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = tm.classroom_id AND ce.student_id = auth.uid())
        )
    )
  );

CREATE POLICY "Ver estado de generacion de mis clases" ON public.study_card_generation
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.teaching_materials tm
      WHERE tm.id = study_card_generation.material_id
        AND (
          tm.teacher_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = tm.classroom_id AND ce.student_id = auth.uid())
        )
    )
  );

-- Avance propio. Los comandos van separados (nunca FOR ALL) y el INSERT exige poder VER la tarjeta (la subconsulta
-- a study_cards aplica su propio RLS).
CREATE POLICY "Ver mi avance de tarjetas" ON public.student_card_state
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Crear mi avance de tarjetas" ON public.student_card_state
  FOR INSERT WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.study_cards sc WHERE sc.id = card_id)
  );

CREATE POLICY "Actualizar mi avance de tarjetas" ON public.student_card_state
  FOR UPDATE USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Borrar mi avance de tarjetas" ON public.student_card_state
  FOR DELETE USING (student_id = auth.uid());

-- Sin escritura del navegador sobre tarjetas ni generacion: solo service role (que ignora RLS).
REVOKE INSERT, UPDATE, DELETE ON public.study_cards FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.study_card_generation FROM anon, authenticated;
REVOKE ALL ON public.study_cards, public.study_card_generation, public.student_card_state FROM anon;
