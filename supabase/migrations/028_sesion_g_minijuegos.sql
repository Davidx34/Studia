-- Migration 028: 4 minijuegos nuevos del catalogo PDF (Sesion G)
-- Fase 11 · Sesion G · Stud.ia
--
-- Amplia el CHECK de "type" para los 4 minijuegos del PDF
-- manual_prompts_minijuegos_ai.pdf que todavia no estaban integrados:
--   - Minijuego 2: El Impostor Cognitivo -> impostor_cognitivo
--   - Minijuego 4: Alquimia Conceptual   -> alquimia_conceptual
--   - Minijuego 5: Cuarto de Crisis      -> cuarto_crisis
--   - Minijuego 6: El Juicio al Conocimiento -> juicio_conocimiento
-- (Minijuego 1 = el_descifrador y Minijuego 3 = linea_del_tiempo ya estaban
-- integrados desde la Sesion D). Reusa game_type/game_data (021) sin cambios
-- de columna, solo amplia el CHECK.

ALTER TABLE lesson_questions DROP CONSTRAINT IF EXISTS lesson_questions_type_check;
ALTER TABLE lesson_questions ADD CONSTRAINT lesson_questions_type_check
  CHECK (type IN (
    'multiple_choice', 'true_false', 'fill_blank', 'match', 'short_answer',
    'el_descifrador', 'linea_del_tiempo', 'categorias_rapidas', 'flashcard_rapida',
    'impostor_cognitivo', 'alquimia_conceptual', 'cuarto_crisis', 'juicio_conocimiento'
  ));
