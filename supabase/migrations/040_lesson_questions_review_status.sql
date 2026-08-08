-- Migration 040: review_status en lesson_questions (Fase 1.3 post-auditoria,
-- Protocolos 7.3 simplificado + 7.5)
--
-- Antes de este cambio, toda pregunta generada quedaba disponible para
-- servir de inmediato (o en la reserva backup) sin ningun control de
-- calidad automatizado. Se agrega un juez LLM (Gemini Flash, proveedor
-- DISTINTO al generador Cohere -- para no heredar el mismo sesgo/error del
-- generador) que corre como paso posterior a la generacion bulk y clasifica
-- cada pregunta nueva con una rubrica.
--
-- pending: recien generada, todavia no paso por el juez (estado inicial).
-- approved: el juez la aprobo.
-- rejected: el juez la rechazo (se excluye de is_backup=false via el
--   propio codigo que llama al juez, no via trigger -- ver
--   src/lib/actions/judge-pool.ts).
-- human_review: el juez no esta seguro (verdict "review") -- requiere que
--   el profesor la revise a mano antes del piloto en
--   /teacher/classrooms/[id]/review.

ALTER TABLE lesson_questions
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'human_review'));

CREATE INDEX IF NOT EXISTS idx_lesson_questions_review_status ON lesson_questions(review_status);

-- Hueco de RLS que esta migracion cierra proactivamente: lesson_questions
-- NUNCA tuvo policy de UPDATE (ni para profesor ni estudiante) -- el juez y
-- la pagina de revision del profesor necesitan poder actualizar
-- review_status (y opcionalmente is_backup al rechazar). Sin esta policy,
-- el UPDATE fallaria en silencio con 0 filas afectadas, exactamente el
-- patron de bug que la auditoria documento 3 veces en migraciones 031/033/036
-- para otras tablas -- se agrega aqui desde el primer momento en vez de
-- descubrirlo en produccion.
CREATE POLICY "teachers_update_lesson_questions"
  ON lesson_questions FOR UPDATE
  USING (module_id IN (SELECT cm.id FROM content_modules cm WHERE cm.teacher_id = auth.uid()))
  WITH CHECK (module_id IN (SELECT cm.id FROM content_modules cm WHERE cm.teacher_id = auth.uid()));
