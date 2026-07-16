-- Migration 020: RPCs de analitica de brecha de conocimiento
-- Fase 11 · Sesion C · Stud.ia
--
-- Convierte los datos crudos de question_attempts (Sesion B) en 3 vistas
-- agregadas para el panel de Progreso del profesor. SECURITY INVOKER
-- (no DEFINER): corren con los permisos del profesor que llama, y ya
-- existen policies de RLS que le permiten leer question_attempts y
-- profiles de su propia clase/estudiantes — misma logica de
-- defense-in-depth usada en el resto del proyecto.

-- RPC 1: Brecha de conocimiento de la clase (conceptos + % error)
CREATE OR REPLACE FUNCTION get_class_concept_metrics(p_classroom_id uuid)
RETURNS TABLE(
  concept_tag text,
  total_attempts bigint,
  error_count bigint,
  error_rate numeric,
  affected_students bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    qa.concept_tag,
    COUNT(*) AS total_attempts,
    COUNT(*) FILTER (WHERE NOT qa.was_correct) AS error_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE NOT qa.was_correct) / COUNT(*), 1) AS error_rate,
    COUNT(DISTINCT qa.student_id) AS affected_students
  FROM question_attempts qa
  WHERE qa.classroom_id = p_classroom_id
    AND qa.concept_tag IS NOT NULL
  GROUP BY qa.concept_tag
  ORDER BY error_rate DESC;
$$;

-- RPC 2: Desempeño por estudiante (general + desglose por concepto en jsonb)
CREATE OR REPLACE FUNCTION get_student_metrics(p_classroom_id uuid)
RETURNS TABLE(
  student_id uuid,
  student_name text,
  total_attempts bigint,
  correct_attempts bigint,
  overall_accuracy numeric,
  concepts_breakdown jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH student_overall AS (
    SELECT
      qa.student_id,
      COUNT(*) AS total_attempts,
      COUNT(*) FILTER (WHERE qa.was_correct) AS correct_attempts,
      ROUND(100.0 * COUNT(*) FILTER (WHERE qa.was_correct) / COUNT(*), 1) AS accuracy
    FROM question_attempts qa
    WHERE qa.classroom_id = p_classroom_id
    GROUP BY qa.student_id
  ),
  student_by_concept AS (
    SELECT
      per_concept.student_id,
      jsonb_object_agg(
        per_concept.concept_tag,
        jsonb_build_object(
          'correct', per_concept.correct,
          'total', per_concept.total,
          'accuracy', per_concept.accuracy
        )
      ) AS concepts
    FROM (
      SELECT
        student_id,
        concept_tag,
        COUNT(*) FILTER (WHERE was_correct) AS correct,
        COUNT(*) AS total,
        ROUND(100.0 * COUNT(*) FILTER (WHERE was_correct) / COUNT(*), 1) AS accuracy
      FROM question_attempts
      WHERE classroom_id = p_classroom_id
        AND concept_tag IS NOT NULL
      GROUP BY student_id, concept_tag
    ) per_concept
    GROUP BY per_concept.student_id
  )
  SELECT
    so.student_id,
    COALESCE(p.full_name, p.username, 'Estudiante') AS student_name,
    so.total_attempts,
    so.correct_attempts,
    so.accuracy,
    COALESCE(sbc.concepts, '{}'::jsonb) AS concepts_breakdown
  FROM student_overall so
  LEFT JOIN student_by_concept sbc ON sbc.student_id = so.student_id
  LEFT JOIN profiles p ON p.id = so.student_id
  ORDER BY so.accuracy ASC;
$$;

-- RPC 3: Matriz concepto x estudiante (para el heatmap)
CREATE OR REPLACE FUNCTION get_concept_student_matrix(p_classroom_id uuid)
RETURNS TABLE(
  student_id uuid,
  student_name text,
  concept_tag text,
  correct bigint,
  total bigint,
  accuracy numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    qa.student_id,
    COALESCE(p.full_name, p.username, 'Estudiante') AS student_name,
    qa.concept_tag,
    COUNT(*) FILTER (WHERE qa.was_correct) AS correct,
    COUNT(*) AS total,
    ROUND(100.0 * COUNT(*) FILTER (WHERE qa.was_correct) / COUNT(*), 1) AS accuracy
  FROM question_attempts qa
  LEFT JOIN profiles p ON p.id = qa.student_id
  WHERE qa.classroom_id = p_classroom_id
    AND qa.concept_tag IS NOT NULL
  GROUP BY qa.student_id, p.full_name, p.username, qa.concept_tag
  ORDER BY student_name, qa.concept_tag;
$$;

GRANT EXECUTE ON FUNCTION get_class_concept_metrics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_student_metrics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_concept_student_matrix(uuid) TO authenticated;
