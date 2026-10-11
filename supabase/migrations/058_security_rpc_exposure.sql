-- Revision de seguridad (2026-10-11): funciones SECURITY DEFINER expuestas a cualquiera con la llave anon.
--
-- La llave anon es PUBLICA (va en el JavaScript del navegador) y PostgREST expone como RPC toda funcion con
-- EXECUTE para anon. Verificado en produccion con una simulacion en transaccion revertida: con el rol anon se
-- podia
--   * dev_list_recent_profiles()            -> volcar perfiles (correos, nombres, roles)
--   * dev_list_pending_registrations()      -> ver las invitaciones pendientes
--   * dev_add_pending_registration(email,'teacher') -> auto-invitarse como PROFESOR y registrarse como tal
--   * dev_delete_pending_registration(id)   -> borrar invitaciones
-- ademas de funciones que aceptan un user_id/classroom_id arbitrario (racha, logros, corazones, cache de lecciones,
-- busqueda de fragmentos de material de cualquier clase).
--
-- Reglas que se aplican aqui:
--   1. dev_*: solo service_role. El panel /dev las llama desde el servidor con la llave de servicio.
--   2. Funciones por usuario: el llamador debe SER ese usuario (auth.uid() = p_user_id); service_role queda exento.
--      Las originales se renombran a _impl y se cierran a todos; la funcion publica es un envoltorio con la guarda
--      (asi no se reescribe ni se arriesga la logica que ya funciona).
--   3. Funciones por clase: el llamador debe ser el profesor o un inscrito.
--   4. Nada de EXECUTE para anon ni PUBLIC salvo lo imprescindible (check_pending_registration: el registro por
--      invitacion lo consulta antes de tener sesion).
--   5. Un estudiante ya no puede insertar su propia inscripcion directamente (saltaba el codigo de clase y dejaba
--      poner cualquier teacher_id); se inscribe con join_classroom_by_code.
--
-- Nota: dentro de una funcion SECURITY DEFINER current_user es el dueño, no el llamador; por eso las guardas usan
-- auth.role() / auth.uid() (que siguen siendo los del llamador).

-- 1. dev_* -> solo service_role
REVOKE ALL ON FUNCTION public.dev_add_pending_registration(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dev_analytics_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dev_delete_pending_registration(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dev_list_pending_registrations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dev_list_recent_profiles(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dev_add_pending_registration(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dev_analytics_summary() TO service_role;
GRANT EXECUTE ON FUNCTION public.dev_delete_pending_registration(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dev_list_pending_registrations() TO service_role;
GRANT EXECUTE ON FUNCTION public.dev_list_recent_profiles(integer) TO service_role;

-- 2. Funciones por usuario: renombrar y envolver con guarda
ALTER FUNCTION public.check_and_update_streak(uuid) RENAME TO _check_and_update_streak_impl;
ALTER FUNCTION public.recover_hearts(uuid) RENAME TO _recover_hearts_impl;
ALTER FUNCTION public.evaluate_achievements(uuid) RENAME TO _evaluate_achievements_impl;
ALTER FUNCTION public._check_and_update_streak_impl(uuid) SET search_path = public;
ALTER FUNCTION public._recover_hearts_impl(uuid) SET search_path = public;
ALTER FUNCTION public._evaluate_achievements_impl(uuid) SET search_path = public;
REVOKE ALL ON FUNCTION public._check_and_update_streak_impl(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._recover_hearts_impl(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._evaluate_achievements_impl(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_and_update_streak(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN public._check_and_update_streak_impl(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_hearts(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN public._recover_hearts_impl(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.evaluate_achievements(p_user_id uuid)
RETURNS TABLE(achievement_id uuid, name text, rarity text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT i.achievement_id, i.name, i.rarity FROM public._evaluate_achievements_impl(p_user_id) i;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_update_streak(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recover_hearts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evaluate_achievements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_and_update_streak(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recover_hearts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_achievements(uuid) TO authenticated, service_role;

-- 3. Funciones por clase
CREATE OR REPLACE FUNCTION public.invalidate_lesson_cache(p_classroom_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = p_classroom_id AND c.teacher_id = auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.lesson_generations WHERE classroom_id = p_classroom_id;
  DELETE FROM public.generated_questions
  WHERE module_id IN (SELECT id FROM public.content_modules WHERE classroom_id = p_classroom_id);
END;
$$;
REVOKE ALL ON FUNCTION public.invalidate_lesson_cache(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invalidate_lesson_cache(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.match_material_chunks(query_embedding vector, classroom_id_filter uuid, match_count integer DEFAULT 5)
RETURNS TABLE(chunk_id uuid, content text, metadata jsonb, similarity double precision, material_id uuid, filename text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mc.id, mc.content, mc.metadata, 1 - (mc.embedding <=> query_embedding), mc.material_id, tm.filename
  FROM public.material_chunks mc
  JOIN public.teaching_materials tm ON tm.id = mc.material_id
  WHERE tm.classroom_id = classroom_id_filter
    AND tm.processing_status = 'completed'
    AND mc.embedding IS NOT NULL
    AND (
      auth.role() = 'service_role'
      OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id_filter AND c.teacher_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = classroom_id_filter AND ce.student_id = auth.uid())
    )
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.match_material_chunks_scoped(query_embedding vector, material_ids uuid[], classroom_id_filter uuid, match_count integer DEFAULT 5)
RETURNS TABLE(chunk_id uuid, content text, metadata jsonb, similarity double precision, material_id uuid, filename text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mc.id, mc.content, mc.metadata, 1 - (mc.embedding <=> query_embedding), mc.material_id, tm.filename
  FROM public.material_chunks mc
  JOIN public.teaching_materials tm ON tm.id = mc.material_id
  WHERE mc.material_id = ANY(material_ids)
    AND tm.classroom_id = classroom_id_filter
    AND tm.processing_status = 'completed'
    AND mc.embedding IS NOT NULL
    AND (
      auth.role() = 'service_role'
      OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id_filter AND c.teacher_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.class_enrollments ce WHERE ce.classroom_id = classroom_id_filter AND ce.student_id = auth.uid())
    )
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
$$;
REVOKE ALL ON FUNCTION public.match_material_chunks(vector, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_material_chunks_scoped(vector, uuid[], uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_material_chunks(vector, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_material_chunks_scoped(vector, uuid[], uuid, integer) TO authenticated, service_role;

-- 4. Sin EXECUTE anonimo en lo que exige sesion
REVOKE ALL ON FUNCTION public.join_classroom_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_classroom_by_code(text) TO authenticated, service_role;

-- 5. La inscripcion de un estudiante pasa SOLO por join_classroom_by_code (exige el codigo de una clase activa).
DROP POLICY IF EXISTS "Students pueden inscribirse" ON public.class_enrollments;

-- El profesor inscribe estudiantes ya registrados (invitarlos por correo, src/lib/actions/classrooms.ts). Con la
-- politica anterior esa insercion solo funcionaba si student_id = auth.uid(), es decir, nunca para el profesor.
-- Ahora: solo en SUS clases y firmando como su propio teacher_id.
CREATE POLICY "Profesor inscribe en su clase" ON public.class_enrollments
  FOR INSERT WITH CHECK (
    teacher_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid())
  );
