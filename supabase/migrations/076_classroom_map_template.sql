-- 076: plantilla del MAPA DE APRENDIZAJE que el PROFESOR elige para su clase.
--
-- El mapa del estudiante pasa a tener una seccion por clase, y cada una se pinta con la plantilla que eligio su profesor. Los modulos y sus posiciones
-- (content_modules.map_position_x/y) no cambian: la plantilla solo decide como se PINTAN. El catalogo vive en codigo (src/lib/map/mapTemplates.ts); aqui solo
-- se guarda el id, y un id desconocido se muestra con el mapa de siempre ('islas'). Por eso el CHECK valida la FORMA del id y no una lista cerrada: agregar una
-- plantilla nueva no necesita otra migracion.
--
-- Quien puede cambiarla: solo el profesor de la clase (la politica "Teachers editan sus clases" de la 051). La leen el profesor y los estudiantes inscritos.

ALTER TABLE public.classrooms
  ADD COLUMN IF NOT EXISTS map_template text NOT NULL DEFAULT 'islas';

DO $$
BEGIN
  ALTER TABLE public.classrooms
    ADD CONSTRAINT classrooms_map_template_format CHECK (map_template ~ '^[a-z][a-z0-9-]{0,31}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.classrooms.map_template IS 'Id de la plantilla con que se muestra el mapa de aprendizaje de la clase (catalogo en src/lib/map/mapTemplates.ts).';
