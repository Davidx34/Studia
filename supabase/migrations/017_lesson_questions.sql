-- Migration 017: lesson_questions (cache de preguntas de lección)
-- Fase 11 · Sesión #4 · Stud.ia
--
-- Objetivo: dejar de llamar a Cohere en CADA apertura de módulo (2-5s de latencia).
-- En vez de pre-generar 20 preguntas al crear el módulo (requeriría duplicar el
-- prompt/lógica de tipos entre la Edge Function de Deno y esta API de Next.js),
-- el cacheo es incremental: /api/generate-questions revisa primero esta tabla;
-- si hay >=5 filas, sirve 5 al azar (instantáneo); si no, genera con Cohere como
-- hoy, responde de inmediato al estudiante, Y guarda lo generado aquí para que
-- las próximas aperturas sean rápidas. El pool crece solo con el uso real.
--
-- Las columnas espejan exactamente el shape que ya usa
-- src/app/api/generate-questions/route.ts y que renderiza
-- src/app/(student)/lesson/[id]/page.tsx (type/q/opts/ok/exp/answers/pairs/keywords),
-- para no tener que tocar el render de preguntas existente.
--
-- ON DELETE CASCADE en module_id: al borrar/regenerar módulos (botón
-- "Regenerar mapa"), el cache viejo se limpia solo, sin necesitar TTL/expires_at.

CREATE TABLE IF NOT EXISTS lesson_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES content_modules(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('multiple_choice', 'true_false', 'fill_blank', 'match', 'short_answer')),
  q text NOT NULL,
  opts jsonb,            -- multiple_choice: ["A. ...", "B. ...", ...]
  ok jsonb,              -- multiple_choice: integer index · true_false: boolean
  answers text[],        -- fill_blank: palabras correctas
  pairs jsonb,           -- match: [{"term": "...", "def": "..."}, ...]
  keywords text[],       -- short_answer: palabras clave esperadas
  exp text,              -- explicación mostrada tras responder
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_questions_module_id ON lesson_questions(module_id);

ALTER TABLE lesson_questions ENABLE ROW LEVEL SECURITY;

-- Estudiantes inscritos en la clase del módulo pueden leer el cache de esas preguntas.
CREATE POLICY "students_read_lesson_questions"
  ON lesson_questions FOR SELECT
  USING (
    module_id IN (
      SELECT cm.id FROM content_modules cm
      JOIN class_enrollments ce ON ce.classroom_id = cm.classroom_id
      WHERE ce.student_id = auth.uid()
    )
  );

-- Profesores dueños del módulo también pueden leerlas (debug/soporte).
CREATE POLICY "teachers_read_lesson_questions"
  ON lesson_questions FOR SELECT
  USING (
    module_id IN (
      SELECT cm.id FROM content_modules cm WHERE cm.teacher_id = auth.uid()
    )
  );

-- El API route inserta usando el cliente autenticado del propio estudiante
-- (no service_role), así que necesita permiso de INSERT sobre módulos de su clase.
CREATE POLICY "students_insert_lesson_questions"
  ON lesson_questions FOR INSERT
  WITH CHECK (
    module_id IN (
      SELECT cm.id FROM content_modules cm
      JOIN class_enrollments ce ON ce.classroom_id = cm.classroom_id
      WHERE ce.student_id = auth.uid()
    )
  );
