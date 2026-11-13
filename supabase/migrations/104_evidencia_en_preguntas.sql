-- 104: evidencia (cita literal del material) guardada con cada pregunta (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §15).
--
-- Criterio del profesor: todo debe estar explicitamente en el material. Con EVIDENCE_REQUIRED=on la generacion exige a la IA una frase literal del material que respalde la respuesta, el codigo comprueba que
-- existe y la guarda aqui, para que el profesor la vea al revisar la pregunta. Aditiva y nullable: sin el interruptor encendido nadie escribe estas columnas y todo funciona como antes.
--
-- Seguridad: la evidencia CONTIENE la respuesta. Se guarda en la misma tabla que ya guarda la respuesta correcta (ok / answers) y se quita de lo que se sirve al estudiante en la aplicacion.
-- Para deshacer: ALTER TABLE public.lesson_questions DROP COLUMN evidence, DROP COLUMN evidence_status;

ALTER TABLE public.lesson_questions
  ADD COLUMN IF NOT EXISTS evidence text,
  ADD COLUMN IF NOT EXISTS evidence_status text;

ALTER TABLE public.lesson_questions DROP CONSTRAINT IF EXISTS lesson_questions_evidence_len_check;
ALTER TABLE public.lesson_questions ADD CONSTRAINT lesson_questions_evidence_len_check CHECK (evidence IS NULL OR char_length(evidence) <= 800);

ALTER TABLE public.lesson_questions DROP CONSTRAINT IF EXISTS lesson_questions_evidence_status_check;
ALTER TABLE public.lesson_questions ADD CONSTRAINT lesson_questions_evidence_status_check CHECK (evidence_status IS NULL OR evidence_status = 'verified');

COMMENT ON COLUMN public.lesson_questions.evidence IS 'Frase LITERAL del material que respalda la respuesta correcta (verificada por codigo al generar). Contiene la respuesta: no se sirve al estudiante.';
COMMENT ON COLUMN public.lesson_questions.evidence_status IS 'verified = la cita existia literalmente en el material que recibio el generador; NULL = pregunta sin evidencia (anterior al interruptor o minijuego).';
