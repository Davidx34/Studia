-- Migration 024: soporte para el minijuego "Categorias Rapidas"
-- Fase 11 · Sesion D.3 · Stud.ia
--
-- Reusa game_type/game_data (021) sin cambios de columna, solo amplia el
-- CHECK de "type" para permitir el nuevo valor.

ALTER TABLE lesson_questions DROP CONSTRAINT IF EXISTS lesson_questions_type_check;
ALTER TABLE lesson_questions ADD CONSTRAINT lesson_questions_type_check
  CHECK (type IN ('multiple_choice', 'true_false', 'fill_blank', 'match', 'short_answer', 'el_descifrador', 'linea_del_tiempo', 'categorias_rapidas'));
