-- Migration 022: metadata de minijuegos en question_attempts
-- Fase 11 · Sesion D.2-D.4 · Stud.ia
--
-- Los minijuegos nuevos (linea_del_tiempo, categorias_rapidas, flashcard_rapida)
-- generan senales extra que no tiene sentido forzar en columnas fijas
-- (intentos usados, movimientos, tiempo restante). game_type espeja el de
-- lesson_questions para poder filtrar intentos de minijuego sin join; game_metadata
-- guarda el detalle especifico de cada uno.

ALTER TABLE question_attempts ADD COLUMN IF NOT EXISTS game_type text;
ALTER TABLE question_attempts ADD COLUMN IF NOT EXISTS game_metadata jsonb;
-- game_metadata: { attempts, moves_count, time_used_seconds, ... } segun el juego
