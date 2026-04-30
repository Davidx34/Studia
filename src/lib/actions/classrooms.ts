'use server';

// Server actions para classrooms y enrollments
// Fase 11.B · Stud.ia
//
// Diseño:
//   - Cada acción primero verifica auth (auth.uid()) y ownership de la clase.
//   - El RLS de la DB hace de segunda capa de defensa: aunque omitiéramos
//     una verificación aquí, la policy bloquearía la mutación.
//   - revalidatePath después de cada mutación para refrescar las páginas.
//   - Retorna shape consistente: { ok: true, data } o { ok: false, error }.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { parseEmailList } from '@/lib/classrooms/email-parser';

// ============================================================
// Helpers
// ============================================================

async function requireUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { supabase, user };
}

function generateJoinCode(length = 6): string {
  // Alfabeto sin caracteres ambiguos (sin 0, O, 1, I, L)
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

// ============================================================
// createClassroom
// ============================================================

export interface CreateClassroomInput {
  name: string;
  description?: string;
  subject_area?: string;
  grade_level?: string;
}

export interface CreateClassroomResult {
  ok: boolean;
  classroomId?: string;
  joinCode?: string;
  error?: string;
}

export async function createClassroom(input: CreateClassroomInput): Promise<CreateClassroomResult> {
  const { supabase, user } = await requireUser();

  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'El nombre de la clase es obligatorio.' };
  if (name.length > 120) return { ok: false, error: 'El nombre es demasiado largo (máx 120).' };

  // Reintenta join_code hasta 5 veces ante colisión
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = generateJoinCode(6);
    const { data, error } = await supabase
      .from('classrooms')
      .insert({
        teacher_id: user.id,
        name,
        description: input.description?.trim() || null,
        subject_area: input.subject_area?.trim() || null,
        grade_level: input.grade_level?.trim() || null,
        join_code: joinCode,
        is_active: true,
      })
      .select('id, join_code')
      .single();

    if (!error && data) {
      revalidatePath('/teacher/classrooms');
      revalidatePath('/teacher/dashboard');
      return { ok: true, classroomId: data.id, joinCode: data.join_code };
    }

    // Si fue colisión de join_code, reintentamos. Si fue otra cosa, salimos.
    const isCollision = error?.message?.toLowerCase().includes('join_code');
    if (!isCollision) {
      return { ok: false, error: error?.message || 'No se pudo crear la clase.' };
    }
  }
  return { ok: false, error: 'No se pudo generar un código único. Reintenta.' };
}

// ============================================================
// updateClassroom
// ============================================================

export interface UpdateClassroomInput {
  name?: string;
  description?: string | null;
  subject_area?: string | null;
  grade_level?: string | null;
  is_active?: boolean;
}

export async function updateClassroom(id: string, patch: UpdateClassroomInput) {
  const { supabase, user } = await requireUser();

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.description !== undefined) update.description = patch.description?.trim() || null;
  if (patch.subject_area !== undefined) update.subject_area = patch.subject_area || null;
  if (patch.grade_level !== undefined) update.grade_level = patch.grade_level || null;
  if (patch.is_active !== undefined) update.is_active = patch.is_active;

  const { error } = await supabase
    .from('classrooms')
    .update(update)
    .eq('id', id)
    .eq('teacher_id', user.id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/teacher/classrooms');
  revalidatePath(`/teacher/classrooms/${id}`);
  return { ok: true as const };
}

// ============================================================
// deleteClassroom
// ============================================================

export async function deleteClassroom(id: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from('classrooms')
    .delete()
    .eq('id', id)
    .eq('teacher_id', user.id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/teacher/classrooms');
  revalidatePath('/teacher/dashboard');
  return { ok: true as const };
}

// ============================================================
// inviteStudents
// ============================================================

export interface InviteStudentsResult {
  ok: boolean;
  enrolled: string[];
  pending: string[];
  alreadyEnrolled: string[];
  invalidEmails: string[];
  error?: string;
}

export async function inviteStudents(
  classroomId: string,
  emailsRaw: string
): Promise<InviteStudentsResult> {
  const { supabase, user } = await requireUser();

  // 1. Verifico ownership de la classroom
  const { data: classroom, error: cErr } = await supabase
    .from('classrooms')
    .select('id, teacher_id')
    .eq('id', classroomId)
    .eq('teacher_id', user.id)
    .single();

  if (cErr || !classroom) {
    return {
      ok: false,
      enrolled: [],
      pending: [],
      alreadyEnrolled: [],
      invalidEmails: [],
      error: 'Clase no encontrada o sin permisos.',
    };
  }

  // 2. Parse + clasificar emails
  const { valid, invalid } = parseEmailList(emailsRaw);

  if (valid.length === 0) {
    return {
      ok: true,
      enrolled: [],
      pending: [],
      alreadyEnrolled: [],
      invalidEmails: invalid,
    };
  }

  // 3. Lookup en profiles (gracias a migración 015 ya tienen email)
  const { data: existingProfiles } = await supabase
    .from('profiles')
    .select('id, email')
    .in('email', valid);

  const emailToId = new Map<string, string>();
  for (const p of existingProfiles ?? []) {
    if (p.email) emailToId.set(p.email.toLowerCase(), p.id);
  }

  // 4. Lookup quiénes ya están inscritos en esta clase
  const studentIds = Array.from(emailToId.values());
  let alreadyEnrolledIds = new Set<string>();
  if (studentIds.length > 0) {
    const { data: existingEnrollments } = await supabase
      .from('class_enrollments')
      .select('student_id')
      .eq('classroom_id', classroomId)
      .in('student_id', studentIds);
    alreadyEnrolledIds = new Set((existingEnrollments ?? []).map((r) => r.student_id));
  }

  // 5. Clasificar cada email válido
  const toEnroll: { email: string; studentId: string }[] = [];
  const alreadyEnrolled: string[] = [];
  const toPending: string[] = [];

  for (const email of valid) {
    const sid = emailToId.get(email);
    if (sid) {
      if (alreadyEnrolledIds.has(sid)) {
        alreadyEnrolled.push(email);
      } else {
        toEnroll.push({ email, studentId: sid });
      }
    } else {
      toPending.push(email);
    }
  }

  // 6. Bulk INSERT class_enrollments
  if (toEnroll.length > 0) {
    const { error: eErr } = await supabase.from('class_enrollments').insert(
      toEnroll.map((e) => ({
        classroom_id: classroomId,
        student_id: e.studentId,
        teacher_id: user.id,
      }))
    );
    if (eErr) {
      return {
        ok: false,
        enrolled: [],
        pending: [],
        alreadyEnrolled,
        invalidEmails: invalid,
        error: `Error inscribiendo: ${eErr.message}`,
      };
    }
  }

  // 7. Bulk INSERT pending_enrollments (con UNIQUE -> ON CONFLICT DO NOTHING simulado)
  // Como Supabase JS no expone onConflict directamente para "do nothing",
  // hacemos pre-check: filtrar los que ya están en pending_enrollments para esta clase.
  const insertedPending: string[] = [];
  if (toPending.length > 0) {
    const { data: existingPending } = await supabase
      .from('pending_enrollments')
      .select('email')
      .eq('classroom_id', classroomId)
      .in('email', toPending);
    const alreadyPendingSet = new Set(
      (existingPending ?? []).map((r) => r.email.toLowerCase())
    );
    const reallyNewPending = toPending.filter((e) => !alreadyPendingSet.has(e));

    if (reallyNewPending.length > 0) {
      const { error: pErr } = await supabase.from('pending_enrollments').insert(
        reallyNewPending.map((email) => ({
          email,
          classroom_id: classroomId,
          teacher_id: user.id,
        }))
      );
      if (pErr) {
        return {
          ok: false,
          enrolled: toEnroll.map((e) => e.email),
          pending: [],
          alreadyEnrolled,
          invalidEmails: invalid,
          error: `Error invitando: ${pErr.message}`,
        };
      }
      insertedPending.push(...reallyNewPending);
    }
    // Los emails que ya estaban en pending los reportamos también como pending
    // (no son un error; ya estaban invitados)
    for (const e of toPending) {
      if (alreadyPendingSet.has(e) && !insertedPending.includes(e)) {
        insertedPending.push(e);
      }
    }
  }

  revalidatePath(`/teacher/classrooms/${classroomId}/students`);
  revalidatePath('/teacher/classrooms');

  return {
    ok: true,
    enrolled: toEnroll.map((e) => e.email),
    pending: insertedPending,
    alreadyEnrolled,
    invalidEmails: invalid,
  };
}

// ============================================================
// removeEnrollment
// ============================================================

export async function removeEnrollment(classroomId: string, studentId: string) {
  const { supabase, user } = await requireUser();

  // Verificar ownership de la clase antes
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id')
    .eq('id', classroomId)
    .eq('teacher_id', user.id)
    .single();

  if (!classroom) return { ok: false as const, error: 'Clase no encontrada o sin permisos.' };

  const { error } = await supabase
    .from('class_enrollments')
    .delete()
    .eq('classroom_id', classroomId)
    .eq('student_id', studentId);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/teacher/classrooms/${classroomId}/students`);
  revalidatePath('/teacher/classrooms');
  return { ok: true as const };
}

// ============================================================
// cancelPendingInvitation
// ============================================================

export async function cancelPendingInvitation(pendingId: string) {
  const { supabase, user } = await requireUser();

  // RLS de pending_enrollments ya filtra por teacher_id = auth.uid()
  // pero filtramos explícitamente por defensa en profundidad
  const { data: pending } = await supabase
    .from('pending_enrollments')
    .select('id, classroom_id')
    .eq('id', pendingId)
    .eq('teacher_id', user.id)
    .single();

  if (!pending) return { ok: false as const, error: 'Invitación no encontrada.' };

  const { error } = await supabase
    .from('pending_enrollments')
    .delete()
    .eq('id', pendingId);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/teacher/classrooms/${pending.classroom_id}/students`);
  return { ok: true as const };
}
