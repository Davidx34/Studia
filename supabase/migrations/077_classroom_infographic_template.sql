-- 077: plantilla de las INFOGRAFIAS que el PROFESOR elige para su clase.
--
-- Las infografias se guardan como DATOS (linea de tiempo, comparativa, proceso o cifras) en study_cards; la plantilla solo decide como se PINTAN, y se aplica a los cuatro
-- tipos. Cambiarla no vuelve a llamar a la IA ni toca los datos. El catalogo vive en codigo (src/lib/study/infographicTemplates.ts): aqui solo se guarda el id, y un id
-- desconocido se muestra con la plantilla de siempre ('clasica'). Por eso el CHECK valida la FORMA del id y no una lista cerrada: agregar una plantilla nueva no necesita
-- otra migracion.
--
-- Quien puede cambiarla: solo el profesor de la clase (la politica "Teachers editan sus clases" de la 051). La leen el profesor y los estudiantes inscritos.

ALTER TABLE public.classrooms
  ADD COLUMN IF NOT EXISTS infographic_template text NOT NULL DEFAULT 'clasica';

DO $$
BEGIN
  ALTER TABLE public.classrooms
    ADD CONSTRAINT classrooms_infographic_template_format CHECK (infographic_template ~ '^[a-z][a-z0-9-]{0,31}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.classrooms.infographic_template IS 'Id de la plantilla con que se muestran las infografias a los estudiantes (catalogo en src/lib/study/infographicTemplates.ts).';
