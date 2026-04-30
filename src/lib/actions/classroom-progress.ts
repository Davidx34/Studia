'use server';

// Server action: getClassroomProgress
// Fase 11.E · Stud.ia
//
// Devuelve un dataset agregado para la tabla de progreso del prof:
//   - 1 fila por estudiante con: profile + stats agregados + last_activity
//   - 1 array de detalle por (estudiante x módulo)
//   - 1 mapa de actividad semanal (últimas 4 semanas)
//   - metadata de la clase
//
// Una sola llamada de queries optimizadas. Se usa para renderizar la tabla
// y también para el export Excel (mismo shape).

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';

export interface StudentRow {
  studentId: string;
  fullName: string;
  username: string;
  email: string | null;
  avatarUrl: string;
  level: number;
  totalXp: number;
  streakDays: number;
  modulesCompleted: number;
  modulesTotal: number;
  avgScore: number;
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  earnedXpInClass: number;
  totalTimeSeconds: number;
  // Por semana: ms-key (ISO start of week) -> minutes
  weeklyActivity: { weekStart: string; minutes: number }[];
}

export interface ModuleDetailRow {
  studentId: string;
  studentName: string;
  moduleId: string;
  moduleTitle: string;
  status: string;
  score: number | null;
  bestScore: number;
  attempts: number;
  timeSeconds: number;
  earnedXp: number;
  completedAt: string | null;
}

export interface ClassroomMeta {
  id: string;
  name: string;
  description: string | null;
  subjectArea: string | null;
  gradeLevel: string | null;
  joinCode: string;
  teacherName: string;
  teacherEmail: string | null;
  totalMaterials: number;
  totalModules: number;
  createdAt: string;
}

export interface ClassroomProgressData {
  classroom: ClassroomMeta;
  students: StudentRow[];
  details: ModuleDetailRow[];
  /** Sumario para el header */
  summary: {
    activeStudents: number;
    totalStudents: number;
    avgCompletionPct: number;
    totalXpEarned: number;
  };
}

export async function getClassroomProgress(
  classroomId: string
): Promise<{ ok: boolean; data?: ClassroomProgressData; error?: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verificar ownership
  const { data: classroom } = await supabase
    .from('classrooms')
    .select(
      'id, name, description, subject_area, grade_level, join_code, teacher_id, created_at'
    )
    .eq('id', classroomId)
    .eq('teacher_id', user.id)
    .single();
  if (!classroom) return { ok: false, error: 'Clase no encontrada o sin permisos.' };

  // Teacher info
  const { data: teacher } = await supabase
    .from('profiles')
    .select('full_name, username, email')
    .eq('id', classroom.teacher_id)
    .single();

  // Materiales count
  const { count: materialsCount } = await supabase
    .from('teaching_materials')
    .select('*', { count: 'exact', head: true })
    .eq('classroom_id', classroomId);

  // Modulos de la clase
  const { data: modules } = await supabase
    .from('content_modules')
    .select('id, title, base_xp_reward')
    .eq('classroom_id', classroomId)
    .eq('is_active', true);
  const moduleIds = (modules ?? []).map((m) => m.id);
  const moduleTitles = new Map((modules ?? []).map((m) => [m.id, m.title]));
  const totalModules = moduleIds.length;

  // Inscritos
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('student_id, enrolled_at')
    .eq('classroom_id', classroomId);
  const studentIds = (enrollments ?? []).map((e) => e.student_id);

  // Perfiles de estudiantes
  const { data: profiles } =
    studentIds.length > 0
      ? await supabase
          .from('profiles')
          .select(
            'id, full_name, username, email, avatar_url, current_level, total_xp, streak_days'
          )
          .in('id', studentIds)
      : { data: [] };

  // Progreso (todos los registros relevantes)
  const { data: progress } =
    studentIds.length > 0 && moduleIds.length > 0
      ? await supabase
          .from('student_progress')
          .select('*')
          .in('student_id', studentIds)
          .in('module_id', moduleIds)
      : { data: [] };

  // ============================================================
  // Aggregations
  // ============================================================

  // Bucket por estudiante
  const byStudent = new Map<string, any[]>();
  for (const p of progress ?? []) {
    if (!byStudent.has(p.student_id)) byStudent.set(p.student_id, []);
    byStudent.get(p.student_id)!.push(p);
  }

  // Buckets de últimas 4 semanas (week start = lunes 00:00 UTC)
  const now = new Date();
  const weekStarts: Date[] = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    const dow = d.getUTCDay() || 7; // 1=lunes, 7=domingo
    d.setUTCDate(d.getUTCDate() - (dow - 1) - 7 * i);
    weekStarts.push(d);
  }

  function weekKeyFor(iso: string): string | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    for (let i = weekStarts.length - 1; i >= 0; i--) {
      if (d >= weekStarts[i]) return weekStarts[i].toISOString();
    }
    return null;
  }

  // Construir StudentRows
  const students: StudentRow[] = [];
  let totalXpEarned = 0;
  let totalCompletionSum = 0;
  let activeStudentsCount = 0;

  for (const profile of profiles ?? []) {
    const rows = byStudent.get(profile.id) ?? [];
    const completed = rows.filter((r) => r.status === 'completed');
    const avgScore =
      completed.length > 0
        ? Math.round(
            completed.reduce((s, r) => s + (r.score ?? 0), 0) / completed.length
          )
        : 0;
    const lastActivityAt = rows.reduce<string | null>((acc, r) => {
      if (!r.last_attempt_at) return acc;
      if (!acc || new Date(r.last_attempt_at) > new Date(acc)) return r.last_attempt_at;
      return acc;
    }, null);

    let daysSinceActivity: number | null = null;
    if (lastActivityAt) {
      const diff = (now.getTime() - new Date(lastActivityAt).getTime()) / (1000 * 60 * 60 * 24);
      daysSinceActivity = Math.floor(diff);
    }

    const earnedXpInClass = rows.reduce((s, r) => s + (r.earned_xp ?? 0), 0);
    const totalTimeSeconds = rows.reduce((s, r) => s + (r.time_spent_seconds ?? 0), 0);

    // Weekly buckets: minutos por semana basados en time_spent + last_attempt_at
    // Approx: distribuimos el tiempo del módulo a la semana de su last_attempt
    const weeklyMap = new Map<string, number>();
    for (const wk of weekStarts) weeklyMap.set(wk.toISOString(), 0);
    for (const r of rows) {
      if (!r.last_attempt_at || !r.time_spent_seconds) continue;
      const key = weekKeyFor(r.last_attempt_at);
      if (key && weeklyMap.has(key)) {
        weeklyMap.set(key, weeklyMap.get(key)! + Math.round(r.time_spent_seconds / 60));
      }
    }

    students.push({
      studentId: profile.id,
      fullName: profile.full_name ?? profile.username,
      username: profile.username,
      email: profile.email,
      avatarUrl: profile.avatar_url,
      level: profile.current_level ?? 1,
      totalXp: profile.total_xp ?? 0,
      streakDays: profile.streak_days ?? 0,
      modulesCompleted: completed.length,
      modulesTotal: totalModules,
      avgScore,
      lastActivityAt,
      daysSinceActivity,
      earnedXpInClass,
      totalTimeSeconds,
      weeklyActivity: Array.from(weeklyMap.entries()).map(([weekStart, minutes]) => ({
        weekStart,
        minutes,
      })),
    });

    totalXpEarned += earnedXpInClass;
    totalCompletionSum += totalModules > 0 ? completed.length / totalModules : 0;
    if (daysSinceActivity != null && daysSinceActivity <= 7) activeStudentsCount += 1;
  }

  // Detalle por módulo
  const studentNameById = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name ?? p.username])
  );
  const details: ModuleDetailRow[] = (progress ?? []).map((r) => ({
    studentId: r.student_id,
    studentName: studentNameById.get(r.student_id) ?? 'Desconocido',
    moduleId: r.module_id,
    moduleTitle: moduleTitles.get(r.module_id) ?? 'Módulo desconocido',
    status: r.status,
    score: r.score,
    bestScore: r.best_score ?? 0,
    attempts: r.attempts ?? 0,
    timeSeconds: r.time_spent_seconds ?? 0,
    earnedXp: r.earned_xp ?? 0,
    completedAt: r.completed_at,
  }));

  return {
    ok: true,
    data: {
      classroom: {
        id: classroom.id,
        name: classroom.name,
        description: classroom.description,
        subjectArea: classroom.subject_area,
        gradeLevel: classroom.grade_level,
        joinCode: classroom.join_code,
        teacherName: teacher?.full_name ?? teacher?.username ?? 'Profesor',
        teacherEmail: teacher?.email ?? null,
        totalMaterials: materialsCount ?? 0,
        totalModules,
        createdAt: classroom.created_at,
      },
      students,
      details,
      summary: {
        activeStudents: activeStudentsCount,
        totalStudents: students.length,
        avgCompletionPct:
          students.length > 0
            ? Math.round((totalCompletionSum / students.length) * 100)
            : 0,
        totalXpEarned,
      },
    },
  };
}
