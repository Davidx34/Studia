-- Migration 019: concept_tag en lesson_questions
-- Fase 11 · Sesión B · Stud.ia
--
-- Cada pregunta generada queda etiquetada con el concepto específico que evalúa
-- (snake_case, reutilizado entre preguntas del mismo concepto dentro de un módulo),
-- para poder agregar resultados por concepto en question_attempts.

ALTER TABLE lesson_questions ADD COLUMN IF NOT EXISTS concept_tag text;
