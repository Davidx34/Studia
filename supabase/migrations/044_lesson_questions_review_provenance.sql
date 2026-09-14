-- Procedencia de cada veredicto de revision, y la razon que lo motivo.
--
-- Por que existe: lesson_questions.review_status lo escriben DOS actores
-- distintos y la base no guardaba cual de los dos:
--   - judgeModuleQuestionPool (juez IA) escribe approved/rejected/human_review
--   - approveReviewQuestion/rejectReviewQuestion (el profesor, desde
--     /teacher/classrooms/[id]/review) escriben approved/rejected
-- Sin columna de procedencia, una fila "rejected" es indistinguible entre
-- "el juez IA la reprobo" y "el profesor la reprobo". Eso hace imposible la
-- unica medida que importa para saber si el pipeline de IA mejora: cuanto
-- coincide el juez con el criterio humano.
--
-- Esto no es hipotetico: en la review 360 se interpretaron los 49 'rejected'
-- de produccion como decisiones del profesor cuando casi con certeza son del
-- juez IA (48 preguntas seguian sin tocar en la cola de human_review, que es
-- lo unico sobre lo que el profesor puede actuar). La conclusion de fondo no
-- cambiaba, pero la evidencia citada era incorrecta. Esta migracion hace que
-- esa ambiguedad no pueda repetirse.
--
-- Ademas se guarda review_reason: el juez YA calcula una razon por pregunta
-- (JudgeResult.reason) y hasta ahora se descartaba por completo. Persistirla
-- convierte la cola de human_review en algo trabajable -- el profesor ve POR
-- QUE la IA marco cada pregunta en vez de tener que releerla a ciegas -- y es
-- justo lo que hace falta para que etiquete el conjunto de referencia.

ALTER TABLE public.lesson_questions
  ADD COLUMN IF NOT EXISTS reviewed_by text
    CHECK (reviewed_by IS NULL OR reviewed_by IN ('ai_judge', 'teacher')),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reason text;

COMMENT ON COLUMN public.lesson_questions.reviewed_by IS
  'Quien produjo el review_status actual: ai_judge | teacher. NULL = filas anteriores a la migracion 044, cuya procedencia es irrecuperable (no se rellena a mano: una etiqueta inventada es peor que un hueco declarado).';
COMMENT ON COLUMN public.lesson_questions.review_reason IS
  'Razon del veredicto. La escribe el juez IA (JudgeResult.reason); se le muestra al profesor en la cola de revision.';

-- La cola de revision del profesor ordena y filtra por estado; con la
-- procedencia ahora tambien se consulta "que reviso el humano" para medir
-- acuerdo contra el juez. Indice parcial: solo las filas ya revisadas.
CREATE INDEX IF NOT EXISTS idx_lesson_questions_reviewed_by
  ON public.lesson_questions (reviewed_by, review_status)
  WHERE reviewed_by IS NOT NULL;
