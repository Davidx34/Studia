import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { ChevronRight, Search, Flame, Heart, AlertCircle } from 'lucide-react';

export default async function TeacherStudentsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Cargar estudiantes inscritos en cualquier clase del profesor
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('student_id')
    .eq('teacher_id', user.id);

  const studentIds = enrollments?.map((e) => e.student_id) || [];

  const { data: students } = await supabase
    .from('profiles')
    .select('*')
    .in('id', studentIds)
    .order('total_xp', { ascending: false });

  // Conteo de módulos completados por estudiante
  const { data: progress } = await supabase
    .from('student_progress')
    .select('student_id, status, score')
    .in('student_id', studentIds);

  const progressMap = new Map<string, { completed: number; avgScore: number }>();
  for (const id of studentIds) {
    const p = progress?.filter((r) => r.student_id === id) || [];
    const completed = p.filter((r) => r.status === 'completed');
    const avgScore =
      completed.length > 0
        ? Math.round(
            completed.reduce((sum, r) => sum + (r.score || 0), 0) / completed.length
          )
        : 0;
    progressMap.set(id, { completed: completed.length, avgScore });
  }

  const today = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Estudiantes</h1>
        <p className="text-slate-400 mt-1">{students?.length || 0} en total</p>
      </div>

      {/* Lista */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-slate-800 bg-slate-900/50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div className="col-span-4">Estudiante</div>
          <div className="col-span-2 text-center">Nivel</div>
          <div className="col-span-2 text-center">XP</div>
          <div className="col-span-2 text-center">Promedio</div>
          <div className="col-span-2 text-center">Última actividad</div>
        </div>

        <div className="divide-y divide-slate-800">
          {students?.map((s) => {
            const stats = progressMap.get(s.id) || { completed: 0, avgScore: 0 };
            const daysInactive = s.last_activity_date
              ? Math.floor(
                  (today.getTime() - new Date(s.last_activity_date).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              : 999;
            const isAtRisk = daysInactive >= 3;

            return (
              <Link
                key={s.id}
                href={`/teacher/students/${s.id}`}
                className="grid grid-cols-12 gap-4 px-5 py-4 items-center hover:bg-slate-800/50 transition group"
              >
                {/* Nombre */}
                <div className="col-span-12 md:col-span-4 flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center font-bold text-white flex-shrink-0">
                    {s.full_name?.charAt(0) || s.username.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white truncate flex items-center gap-2">
                      {s.full_name}
                      {isAtRisk && (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate">@{s.username}</div>
                  </div>
                </div>

                {/* Nivel */}
                <div className="hidden md:flex md:col-span-2 justify-center">
                  <div className="px-3 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-sm font-semibold">
                    {s.current_level}
                  </div>
                </div>

                {/* XP */}
                <div className="hidden md:block md:col-span-2 text-center">
                  <div className="font-bold text-white">{s.total_xp.toLocaleString()}</div>
                  <div className="text-xs text-slate-500">{stats.completed} módulos</div>
                </div>

                {/* Promedio */}
                <div className="hidden md:block md:col-span-2 text-center">
                  {stats.completed > 0 ? (
                    <div
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                        stats.avgScore >= 80
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : stats.avgScore >= 60
                          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {stats.avgScore}
                    </div>
                  ) : (
                    <span className="text-slate-600 text-sm">—</span>
                  )}
                </div>

                {/* Última actividad */}
                <div className="hidden md:flex md:col-span-2 justify-center items-center gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      isAtRisk ? 'text-amber-400' : 'text-slate-400'
                    }`}
                  >
                    {daysInactive === 0
                      ? 'Hoy'
                      : daysInactive === 1
                      ? 'Ayer'
                      : `Hace ${daysInactive}d`}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
