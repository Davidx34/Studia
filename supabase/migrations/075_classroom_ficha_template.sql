-- 075: plantilla de las fichas de lectura que el PROFESOR elige para su clase.
--
-- Las fichas se guardan como DATOS (titulo, idea principal, puntos clave, terminos, pregunta de reflexion) en study_cards; la plantilla solo decide como se
-- PINTAN. Cambiarla no vuelve a llamar a la IA ni toca las fichas. El catalogo de plantillas vive en codigo (src/lib/study/fichaTemplates.ts): aqui solo se guarda
-- el id elegido, y un id desconocido se muestra con la plantilla por defecto. Por eso el CHECK valida la FORMA del id y no una lista cerrada: agregar una
-- plantilla nueva no necesita otra migracion.
--
-- Quien puede cambiarla: solo el profesor de la clase (la politica "Teachers editan sus clases" de la 051 ya limita los UPDATE a teacher_id = auth.uid()).
-- Quien la lee: el profesor y los estudiantes inscritos (la politica de SELECT existente de classrooms).

ALTER TABLE public.classrooms
  ADD COLUMN IF NOT EXISTS ficha_template text NOT NULL DEFAULT 'clasica';

DO $$
BEGIN
  ALTER TABLE public.classrooms
    ADD CONSTRAINT classrooms_ficha_template_format CHECK (ficha_template ~ '^[a-z][a-z0-9-]{0,31}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.classrooms.ficha_template IS 'Id de la plantilla con que se muestran las fichas de lectura a los estudiantes (catalogo en src/lib/study/fichaTemplates.ts).';
