-- Migration 012: function invalidate_lesson_cache
-- Fase 11.A · Stud.ia
--
-- Invalida TODO el cache de generación de lecciones para una clase:
--   - Borra outlines en lesson_generations de esa clase
--   - Borra preguntas materializadas en generated_questions
--     cuyo módulo pertenezca a esa clase
--
-- Se invoca desde server actions cuando el profesor:
--   - Reemplaza un material (replaceMaterial)
--   - Borra un material (deleteMaterial)
--   - Edita un material que cambia el contenido
--   - Regenera el mapa de la clase
--
-- SECURITY DEFINER + GRANT a authenticated: las server actions corren
-- con el JWT del profesor; la función las deja invalidar SU clase
-- (la validación de ownership la hace la server action antes de llamarla).

CREATE OR REPLACE FUNCTION public.invalidate_lesson_cache(p_classroom_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.lesson_generations
  WHERE classroom_id = p_classroom_id;

  DELETE FROM public.generated_questions
  WHERE module_id IN (
    SELECT id FROM public.content_modules
    WHERE classroom_id = p_classroom_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.invalidate_lesson_cache TO authenticated;
