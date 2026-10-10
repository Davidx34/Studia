-- Cierra dos huecos de seguridad encontrados en la revision del 2026-10-10 (verificados con una simulacion
-- en produccion dentro de una transaccion revertida):
--
-- 1) Un ESTUDIANTE podia convertirse en profesor. La politica "Usuarios actualizan su propio perfil" permite
--    UPDATE de cualquier columna de su fila y `authenticated` tiene UPDATE sobre profiles.role: bastaba un
--    PATCH /rest/v1/profiles con {"role":"teacher"}. Ademas la politica "Teachers manejan sus clases"
--    (FOR ALL, teacher_id = auth.uid()) dejaba a CUALQUIER usuario crear clases, y desde ahi subir y
--    reprocesar materiales gastando cuota de IA.
--
-- 2) Se podian insertar materiales (y, por ende, fragmentos de texto) en la clase de OTRA persona: la politica
--    de INSERT/UPDATE de teaching_materials solo comprobaba teacher_id = auth.uid(), no que la clase fuera suya.
--    Ese texto llega como contexto RAG a las lecciones de los estudiantes de esa clase.
--
-- Las funciones SECURITY DEFINER (apply_pending_registration, handle_new_user...) siguen pudiendo asignar el
-- rol: dentro de ellas current_user es el dueño de la funcion, no `authenticated`.

-- ---------------------------------------------------------------- 1. el rol no se cambia desde la API
CREATE OR REPLACE FUNCTION public.profiles_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'El rol no se puede cambiar desde la aplicacion.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_role_guard ON public.profiles;
CREATE TRIGGER profiles_role_guard
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_role_guard();

-- ---------------------------------------------------------------- 2. solo un profesor crea clases
DROP POLICY IF EXISTS "Teachers manejan sus clases" ON public.classrooms;

CREATE POLICY "Teachers ven sus clases" ON public.classrooms
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "Teachers editan sus clases" ON public.classrooms
  FOR UPDATE USING (teacher_id = auth.uid()) WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Teachers borran sus clases" ON public.classrooms
  FOR DELETE USING (teacher_id = auth.uid());

CREATE POLICY "Solo profesores crean clases" ON public.classrooms
  FOR INSERT WITH CHECK (
    teacher_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('teacher', 'admin'))
  );

-- ---------------------------------------------------------------- 3. materiales solo en clases propias
DROP POLICY IF EXISTS "Teachers insert own materials" ON public.teaching_materials;
CREATE POLICY "Teachers insert own materials" ON public.teaching_materials
  FOR INSERT WITH CHECK (
    teacher_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers update own materials" ON public.teaching_materials;
CREATE POLICY "Teachers update own materials" ON public.teaching_materials
  FOR UPDATE USING (teacher_id = auth.uid())
  WITH CHECK (
    teacher_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = classroom_id AND c.teacher_id = auth.uid())
  );
