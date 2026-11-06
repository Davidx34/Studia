import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { DashboardClient } from './DashboardClient';
import MyClassesSection, { type MyClassCard } from './MyClassesSection';
import { getMyActiveRemediationPlan } from '@/lib/actions/remediation-plans';
import { getReviewPlan } from '@/lib/study/reviewPlanServer';
import { localDate, streakStatus } from '@/lib/streak/status';

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Invitaciones de un profesor a este correo que quedaron pendientes (cuenta creada antes de la invitacion): se
  // convierten en inscripcion antes de listar las clases. Un fallo aqui no debe impedir abrir el inicio.
  try {
    // La funcion es nueva y aun no esta en los tipos generados.
    await (supabase as any).rpc('claim_pending_enrollments');
  } catch (e) {
    console.warn('[claim_pending_enrollments]', e);
  }

  const today = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  // Las siete lecturas son INDEPENDIENTES entre si (todas dependen solo del usuario): se lanzan juntas. Antes iban una tras otra y cada una paga un viaje a la base; medido en
  // produccion, esta pagina era la mas lenta del estudiante (≈1 s con 10 usuarios, 3-4 s con uno solo desde un portatil).
  const [{ data: profile }, { data: inProgress }, { data: missions }, { data: recentAchievements }, { count: totalCompleted }, { data: recentCompletions }, { data: enrollments }] = await Promise.all([
    // Perfil
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    // Modulo en progreso o siguiente disponible
    supabase.from('student_progress').select('*, content_modules(*)').eq('student_id', user.id).eq('status', 'in_progress').order('last_attempt_at', { ascending: false }).limit(1).maybeSingle(),
    // Misiones del dia
    supabase.from('user_missions').select('*, daily_missions(*)').eq('user_id', user.id).eq('assigned_date', today),
    // Achievements recientes (no vistos)
    supabase.from('user_achievements').select('*, achievements(*)').eq('user_id', user.id).order('earned_at', { ascending: false }).limit(3),
    // Stats: modulos completados (dominados al 100 %)
    supabase.from('student_progress').select('*', { count: 'exact', head: true }).eq('student_id', user.id).eq('status', 'completed').gte('best_score', 100),
    // Progreso semanal: modulos completados por dia en los ultimos 7 dias
    supabase.from('student_progress').select('completed_at').eq('student_id', user.id).eq('status', 'completed').gte('completed_at', sevenDaysAgo.toISOString()),
    // Fase 11.F: Mis clases (clases en las que esta inscrito)
    supabase.from('class_enrollments').select('classroom_id').eq('student_id', user.id),
  ]);

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

  const classroomIds = (enrollments ?? []).map((e: any) => e.classroom_id);

  const myClasses: MyClassCard[] = [];
  let nextModule: { id: string; title: string; classroomId: string; classroomName: string } | null = null;
  if (classroomIds.length > 0) {
    // Clases y modulos dependen solo de las inscripciones: se leen juntos.
    const [{ data: classrooms }, { data: classModules }] = await Promise.all([
      supabase.from('classrooms').select('id, name, subject_area, grade_level, teacher_id, is_active').in('id', classroomIds).eq('is_active', true).order('created_at', { ascending: false }),
      // Modulos auto-generados por classroom
      supabase.from('content_modules').select('id, classroom_id, title, order_index').in('classroom_id', classroomIds).eq('auto_generated', true).eq('is_active', true).order('order_index'),
    ]);

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
    const teacherIds = Array.from(new Set((classrooms ?? []).map((c: any) => c.teacher_id)));
    // Profesores y progreso tambien son independientes entre si.
    const [{ data: teachers }, { data: progressRows }] = await Promise.all([
      teacherIds.length ? supabase.from('profiles').select('id, full_name, username').in('id', teacherIds) : Promise.resolve({ data: [] as any[] }),
      moduleIds.length > 0 ? supabase.from('student_progress').select('module_id, status').eq('student_id', user.id).eq('status', 'completed').gte('best_score', 100).in('module_id', moduleIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const teacherById = new Map((teachers ?? []).map((t: any) => [t.id, t]));
    for (const r of progressRows ?? []) {
      completedModuleIds.add((r as any).module_id);
      const cls = moduleIdToClass.get((r as any).module_id);
      if (cls) {
        completedByClassroom.set(cls, (completedByClassroom.get(cls) ?? 0) + 1);
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

  const [activePlan, reviewPlan] = await Promise.all([getMyActiveRemediationPlan(), getReviewPlan(supabase, user.id, classroomIds)]);
  // Racha real (la guardada puede estar vieja si lleva dias sin estudiar): mismas reglas que la base.
  const streak = streakStatus({
    streakDays: (profile as any)?.streak_days,
    lastActivityDate: (profile as any)?.last_activity_date,
    today: localDate(new Date(), (profile as any)?.timezone),
  });

  return (
    <>
      <DashboardClient
        classesSection={<MyClassesSection classes={myClasses} />}
        profile={profile}
        inProgressModule={inProgress}
        nextModule={nextModule}
        missions={missions || []}
        recentAchievements={recentAchievements || []}
        totalCompleted={totalCompleted || 0}
        weeklyProgress={weeklyProgress}
        activePlan={activePlan}
        reviewPlan={reviewPlan}
        streak={streak}
      />
    </>
  );
}
