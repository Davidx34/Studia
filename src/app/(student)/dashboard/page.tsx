import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { DashboardClient } from './DashboardClient';
import MyClassesSection, { type MyClassCard } from './MyClassesSection';
import { getMyActiveRemediationPlan } from '@/lib/actions/remediation-plans';

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

  // Progreso semanal: modulos completados por dia en los ultimos 7 dias
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const { data: recentCompletions } = await supabase
    .from('student_progress')
    .select('completed_at')
    .eq('student_id', user.id)
    .eq('status', 'completed')
    .gte('completed_at', sevenDaysAgo.toISOString());

  const weeklyProgress: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const count = (recentCompletions ?? []).filter(
      (r: any) => r.completed_at?.startsWith(key)
    ).length;
    weeklyProgress.push({ date: key, count });
  }

  // ============================================================
  // Fase 11.F: Mis clases (clases en las que esta inscrito)
  // ============================================================
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('classroom_id')
    .eq('student_id', user.id);
  const classroomIds = (enrollments ?? []).map((e: any) => e.classroom_id);

  const myClasses: MyClassCard[] = [];
  let nextModule: { id: string; title: string; classroomId: string; classroomName: string } | null = null;
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
      .select('id, classroom_id, title, order_index')
      .in('classroom_id', classroomIds)
      .eq('auto_generated', true)
      .eq('is_active', true)
      .order('order_index');

    const totalByClassroom = new Map<string, number>();
    const moduleIdToClass = new Map<string, string>();
    for (const m of classModules ?? []) {
      const k = (m as any).classroom_id as string;
      totalByClassroom.set(k, (totalByClassroom.get(k) ?? 0) + 1);
      moduleIdToClass.set((m as any).id as string, k);
    }

    const moduleIds = (classModules ?? []).map((m: any) => m.id);
    const completedByClassroom = new Map<string, number>();
    const completedModuleIds = new Set<string>();
    if (moduleIds.length > 0) {
      const { data: progressRows } = await supabase
        .from('student_progress')
        .select('module_id, status')
        .eq('student_id', user.id)
        .eq('status', 'completed')
        .in('module_id', moduleIds);
      for (const r of progressRows ?? []) {
        completedModuleIds.add((r as any).module_id);
        const cls = moduleIdToClass.get((r as any).module_id);
        if (cls) {
          completedByClassroom.set(cls, (completedByClassroom.get(cls) ?? 0) + 1);
        }
      }
    }

    // Proximo modulo disponible: primer modulo no completado y desbloqueado
    // (order_index 0, o el anterior en su classroom ya completado).
    for (const c of classrooms ?? []) {
      const classroomModules = (classModules ?? []).filter(
        (m: any) => m.classroom_id === (c as any).id
      );
      for (let i = 0; i < classroomModules.length; i++) {
        const m = classroomModules[i] as any;
        if (completedModuleIds.has(m.id)) continue;
        const prevCompleted = i === 0 || completedModuleIds.has((classroomModules[i - 1] as any).id);
        if (prevCompleted) {
          nextModule = { id: m.id, title: m.title, classroomId: (c as any).id, classroomName: (c as any).name };
        }
        break;
      }
      if (nextModule) break;
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

  const activePlan = await getMyActiveRemediationPlan();

  return (
    <>
      <MyClassesSection classes={myClasses} />
      <DashboardClient
        profile={profile}
        inProgressModule={inProgress}
        nextModule={nextModule}
        missions={missions || []}
        recentAchievements={recentAchievements || []}
        totalCompleted={totalCompleted || 0}
        weeklyProgress={weeklyProgress}
        activePlan={activePlan}
      />
    </>
  );
}
