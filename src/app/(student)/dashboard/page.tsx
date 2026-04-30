import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { DashboardClient } from './DashboardClient';
import MyClassesSection, { type MyClassCard } from './MyClassesSection';

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Cargar perfil
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // Modulo en progreso o siguiente disponible
  const { data: inProgress } = await supabase
    .from('student_progress')
    .select('*, content_modules(*)')
    .eq('student_id', user.id)
    .eq('status', 'in_progress')
    .order('last_attempt_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Misiones del dia
  const today = new Date().toISOString().split('T')[0];
  const { data: missions } = await supabase
    .from('user_missions')
    .select('*, daily_missions(*)')
    .eq('user_id', user.id)
    .eq('assigned_date', today);

  // Achievements recientes (no vistos)
  const { data: recentAchievements } = await supabase
    .from('user_achievements')
    .select('*, achievements(*)')
    .eq('user_id', user.id)
    .order('earned_at', { ascending: false })
    .limit(3);

  // Stats: modulos completados totales
  const { count: totalCompleted } = await supabase
    .from('student_progress')
    .select('*', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('status', 'completed');

  // ============================================================
  // Fase 11.F: Mis clases (clases en las que esta inscrito)
  // ============================================================
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('classroom_id')
    .eq('student_id', user.id);
  const classroomIds = (enrollments ?? []).map((e: any) => e.classroom_id);

  const myClasses: MyClassCard[] = [];
  if (classroomIds.length > 0) {
    const { data: classrooms } = await supabase
      .from('classrooms')
      .select('id, name, subject_area, grade_level, teacher_id, is_active')
      .in('id', classroomIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    const teacherIds = Array.from(new Set((classrooms ?? []).map((c: any) => c.teacher_id)));
    const { data: teachers } = teacherIds.length
      ? await supabase
          .from('profiles')
          .select('id, full_name, username')
          .in('id', teacherIds)
      : { data: [] };
    const teacherById = new Map((teachers ?? []).map((t: any) => [t.id, t]));

    // Modulos auto-generados por classroom + progress
    const { data: classModules } = await supabase
      .from('content_modules')
      .select('id, classroom_id')
      .in('classroom_id', classroomIds)
      .eq('auto_generated', true)
      .eq('is_active', true);

    const totalByClassroom = new Map<string, number>();
    const moduleIdToClass = new Map<string, string>();
    for (const m of classModules ?? []) {
      const k = (m as any).classroom_id as string;
      totalByClassroom.set(k, (totalByClassroom.get(k) ?? 0) + 1);
      moduleIdToClass.set((m as any).id as string, k);
    }

    const moduleIds = (classModules ?? []).map((m: any) => m.id);
    const completedByClassroom = new Map<string, number>();
    if (moduleIds.length > 0) {
      const { data: progressRows } = await supabase
        .from('student_progress')
        .select('module_id, status')
        .eq('student_id', user.id)
        .eq('status', 'completed')
        .in('module_id', moduleIds);
      for (const r of progressRows ?? []) {
        const cls = moduleIdToClass.get((r as any).module_id);
        if (cls) {
          completedByClassroom.set(cls, (completedByClassroom.get(cls) ?? 0) + 1);
        }
      }
    }

    for (const c of classrooms ?? []) {
      const t = teacherById.get((c as any).teacher_id);
      myClasses.push({
        classroomId: (c as any).id,
        name: (c as any).name,
        subjectArea: (c as any).subject_area ?? null,
        gradeLevel: (c as any).grade_level ?? null,
        teacherName: t?.full_name ?? t?.username ?? 'Profesor',
        modulesCompleted: completedByClassroom.get((c as any).id) ?? 0,
        modulesTotal: totalByClassroom.get((c as any).id) ?? 0,
      });
    }
  }

  return (
    <>
      <MyClassesSection classes={myClasses} />
      <DashboardClient
        profile={profile}
        inProgressModule={inProgress}
        missions={missions || []}
        recentAchievements={recentAchievements || []}
        totalCompleted={totalCompleted || 0}
      />
    </>
  );
}
