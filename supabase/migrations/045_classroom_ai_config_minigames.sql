-- Minijuegos habilitados por clase en el "Cerebro de la IA".
--
-- Por que existe: classroom_ai_config le deja al profesor elegir habilidades,
-- tipos de pregunta, profundidad, temas, etc., pero NO los minijuegos. Estos se
-- sorteaban al azar (2 de 8) al generar, o dependian de una eleccion por modulo
-- en la pantalla de Objetivos; el profesor no tenia forma de decir, para toda
-- la clase, "en Ciencias Sociales quiero linea del tiempo y categorias, y nada
-- de cuarto de crisis".
--
-- Semantica: es una LISTA DE PERMITIDOS a nivel de clase.
--   - El valor por defecto son los 8 minijuegos: comportamiento identico al de
--     antes para las clases ya existentes.
--   - Un arreglo VACIO significa "sin minijuegos" y se respeta: el profesor que
--     los desactiva todos no debe recibir ninguno.
--   - La eleccion por modulo (content_modules.minigame_types) sigue existiendo
--     pero solo puede escoger DENTRO de esta lista.
--
-- El CHECK evita que se guarde un identificador que el generador no conoce
-- (un typo aqui se traduciria en un minijuego que nunca se genera, sin error).

ALTER TABLE public.classroom_ai_config
  ADD COLUMN IF NOT EXISTS minigame_types text[] NOT NULL DEFAULT ARRAY[
    'el_descifrador', 'linea_del_tiempo', 'categorias_rapidas', 'flashcard_rapida',
    'impostor_cognitivo', 'alquimia_conceptual', 'cuarto_crisis', 'juicio_conocimiento'
  ]::text[];

ALTER TABLE public.classroom_ai_config
  DROP CONSTRAINT IF EXISTS classroom_ai_config_minigame_types_valid;

ALTER TABLE public.classroom_ai_config
  ADD CONSTRAINT classroom_ai_config_minigame_types_valid CHECK (
    minigame_types <@ ARRAY[
      'el_descifrador', 'linea_del_tiempo', 'categorias_rapidas', 'flashcard_rapida',
      'impostor_cognitivo', 'alquimia_conceptual', 'cuarto_crisis', 'juicio_conocimiento'
    ]::text[]
  );

COMMENT ON COLUMN public.classroom_ai_config.minigame_types IS
  'Minijuegos permitidos para la clase (lista de permitidos). Vacio = ninguno. La eleccion por modulo solo puede escoger dentro de esta lista. Ver migracion 045.';
