-- Migration 021: soporte para minijuegos en lesson_questions
-- Fase 11 · Sesion D.1 · Stud.ia
--
-- Primer minijuego: "El Descifrador" (adivina la palabra clave con pistas).
-- game_type/game_data quedan genericos para que futuros minijuegos
-- (linea_del_tiempo, categorias_rapidas, flashcard_rapida) reusen las
-- mismas columnas sin nueva migracion.
--
-- Se amplia el CHECK de "type" para incluir 'el_descifrador' (no se puede
-- ALTER un CHECK existente sin recrearlo; no se pierde ningun dato, solo
-- se permite un valor nuevo).

ALTER TABLE lesson_questions DROP CONSTRAINT IF EXISTS lesson_questions_type_check;
ALTER TABLE lesson_questions ADD CONSTRAINT lesson_questions_type_check
  CHECK (type IN ('multiple_choice', 'true_false', 'fill_blank', 'match', 'short_answer', 'el_descifrador'));

ALTER TABLE lesson_questions ADD COLUMN IF NOT EXISTS game_type text;
ALTER TABLE lesson_questions ADD COLUMN IF NOT EXISTS game_data jsonb;
-- game_data (el_descifrador): { word_to_guess, initial_clue, hints[], pedagogical_feedback }
