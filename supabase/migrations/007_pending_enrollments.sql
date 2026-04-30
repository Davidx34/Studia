-- Migration 007: pending_enrollments table
-- Fase 11.A · Stud.ia
--
-- Cola de invitaciones por email a estudiantes que todavía NO se registraron.
-- Cuando un usuario se registra, el trigger auto_enroll_pending (migración 013)
-- consume estas filas y crea las class_enrollments correspondientes.
--
-- UNIQUE (email, classroom_id) evita invitaciones duplicadas a la misma clase.
-- Se indexa LOWER(email) para que el matching sea case-insensitive.
--
-- RLS:
--   - Profesor: full CRUD sobre las invitaciones de SUS clases
--   - INSERT verifica adicionalmente que la classroom le pertenece

CREATE TABLE public.pending_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(email, classroom_id)
);

CREATE INDEX idx_pending_email ON public.pending_enrollments(LOWER(email));
CREATE INDEX idx_pending_classroom ON public.pending_enrollments(classroom_id);

ALTER TABLE public.pending_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers see own pendings" ON public.pending_enrollments
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "Teachers insert pendings for own classes" ON public.pending_enrollments
  FOR INSERT WITH CHECK (
    teacher_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.classrooms c
      WHERE c.id = classroom_id
        AND c.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers delete own pendings" ON public.pending_enrollments
  FOR DELETE USING (teacher_id = auth.uid());
