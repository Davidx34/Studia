import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { Users, BookOpen, TrendingUp, AlertTriangle, ChevronRight, Plus } from 'lucide-react';

export default async function TeacherDashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Cargar las clases del profesor
  const { data: classrooms } = await supabase
    .from('classrooms')
    .select('*')
    .eq('teacher_id', user.id)
    .order('created_at', { ascending: false });

  if (!classrooms || classrooms.length === 0) {
    return (
      <div className="text-center py-20">
        <BookOpen className="w-16 h-16 text-slate-600 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Aún no tienes clases</h2>
        <p className="text-slate-400 mb-6">Crea tu primera clase para empezar.</p>
      </div>
    );
  }

  // Para cada clase, obtener métricas
  const classroomIds = classrooms.map((c) => c.id);

  // Estudiantes del profesor
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('student_id, classroom_id')
    .in('classroom_id', classroomIds);

  const studentIds = enrollments?.map((e) => e.student_id) || [];

  // Perfiles de los estudiantes
  const { data: students } = await supabase
    .from('profiles')
    .select('id, full_name, username, current_level, total_xp, streak_days, last_activity_date')
    .in('id', studentIds);

  // Módulos del profesor
  const { count: moduleCount } = await supabase
    .from('content_modules')
    .select('*', { count: 'exact', head: true })
    .eq('teacher_id', user.id);

  // Progreso agregado de los estudiantes
  const { data: progressRows } = await supabase
    .from('student_progress')
    .select('student_id, status, score')
    .in('student_id', studentIds);

  // Calcular métricas
  const totalStudents = students?.length || 0;
  const completedCount = progressRows?.filter((p) => p.status === 'completed').length || 0;
  const avgScore =
    progressRows && progressRows.length > 0
      ? Math.round(
          progressRows
            .filter((p) => p.status === 'completed' && p.score !== null)
            .reduce((sum, p) => sum + (p.score || 0), 0) /
            (progressRows.filter((p) => p.status === 'completed').length || 1)
        )
      : 0;

  // Estudiantes en riesgo: 3+ días sin actividad
  const today = new Date();
  const atRiskStudents =
    students?.filter((s) => {
      if (!s.last_activity_date) return true;
      const lastDate = new Date(s.last_activity_date);
      const daysDiff = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff >= 3;
    }) || [];

  // Top 3 estudiantes
  const topStudents = [...(students || [])]
    .sort((a, b) => b.total_xp - a.total_xp)
    .slice(0, 3);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 mt-1">
          {classrooms.length} {classrooms.length === 1 ? 'clase activa' : 'clases activas'}
        </p>
      </div>

      {/* Métricas grandes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={Users}
          label="Estudiantes"
          value={totalStudents}
          accent="violet"
        />
        <MetricCard
          icon={BookOpen}
          label="Módulos creados"
          value={moduleCount || 0}
          accent="cyan"
        />
        <MetricCard
          icon={TrendingUp}
          label="Promedio de clase"
          value={`${avgScore}`}
          suffix="/100"
          accent="emerald"
        />
        <MetricCard
          icon={AlertTriangle}
          label="En riesgo"
          value={atRiskStudents.length}
          accent={atRiskStudents.length > 0 ? 'amber' : 'slate'}
        />
      </div>

      {/* Alerta de estudiantes en riesgo */}
      {atRiskStudents.length > 0 && (
        <section className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-300" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white">Estudiantes que necesitan atención</h3>
              <p className="text-sm text-slate-400 mt-0.5">
                Llevan 3 días o más sin actividad en la plataforma
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {atRiskStudents.map((s) => {
              const daysInactive = s.last_activity_date
                ? Math.floor(
                    (today.getTime() - new Date(s.last_activity_date).getTime()) /
                      (1000 * 60 * 60 * 24)
                  )
                : 999;
              return (
                <Link
                  key={s.id}
                  href={`/teacher/students/${s.id}`}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-amber-500/40 hover:bg-slate-900 transition group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/30 border border-amber-500/40 flex items-center justify-center font-bold text-amber-200 text-sm flex-shrink-0">
                      {s.full_name?.charAt(0) || s.username.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{s.full_name}</div>
                      <div className="text-xs text-slate-500">Nivel {s.current_level} · {s.total_xp} XP</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-bold text-amber-300 bg-amber-500/15 px-2 py-1 rounded-md border border-amber-500/30">
                      {daysInactive}d
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Layout de dos columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top estudiantes */}
        <section className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Top de la clase</h3>
            <Link href="/teacher/students" className="text-sm text-violet-400 hover:text-violet-300">
              Ver todos →
            </Link>
          </div>

          <div className="space-y-2">
            {topStudents.map((s, idx) => {
              const medals = ['🥇', '🥈', '🥉'];
              return (
                <Link
                  key={s.id}
                  href={`/teacher/students/${s.id}`}
                  className="flex items-center gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-violet-500/40 transition group"
                >
                  <div className="text-2xl flex-shrink-0">{medals[idx]}</div>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center font-bold text-white text-sm flex-shrink-0">
                    {s.full_name?.charAt(0) || s.username.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white truncate">{s.full_name}</div>
                    <div className="text-xs text-slate-500">Nivel {s.current_level} · {s.streak_days}🔥</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-violet-300">{s.total_xp.toLocaleString()}</div>
                    <div className="text-xs text-slate-500">XP totales</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Acciones rápidas */}
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-white">Acciones rápidas</h3>

          <Link
            href="/teacher/content/new"
            className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/30 hover:from-violet-500/30 hover:to-purple-500/30 transition group"
          >
            <div className="w-10 h-10 rounded-xl bg-violet-500/30 flex items-center justify-center flex-shrink-0">
              <Plus className="w-5 h-5 text-violet-200" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-white">Crear módulo</div>
              <div className="text-xs text-slate-400">Nuevo contenido para tu clase</div>
            </div>
          </Link>

          <Link
            href="/teacher/students"
            className="flex items-center gap-3 p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-violet-500/40 transition"
          >
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 text-cyan-300" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-white">Ver estudiantes</div>
              <div className="text-xs text-slate-400">{totalStudents} en total</div>
            </div>
          </Link>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
              Código de aula
            </div>
            <div className="text-xl font-mono font-bold text-white tracking-wider">
              {classrooms[0].join_code}
            </div>
            <div className="text-xs text-slate-500 mt-1">Compártelo con tus estudiantes</div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  suffix,
  accent,
}: {
  icon: any;
  label: string;
  value: string | number;
  suffix?: string;
  accent: 'violet' | 'cyan' | 'emerald' | 'amber' | 'slate';
}) {
  const colors = {
    violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', icon: 'text-violet-300', iconBg: 'bg-violet-500/15' },
    cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', icon: 'text-cyan-300', iconBg: 'bg-cyan-500/15' },
    emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: 'text-emerald-300', iconBg: 'bg-emerald-500/15' },
    amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: 'text-amber-300', iconBg: 'bg-amber-500/15' },
    slate: { bg: 'bg-slate-900', border: 'border-slate-800', icon: 'text-slate-400', iconBg: 'bg-slate-800' },
  };
  const c = colors[accent];

  return (
    <div className={`${c.bg} ${c.border} border rounded-2xl p-4`}>
      <div className={`w-9 h-9 ${c.iconBg} rounded-lg flex items-center justify-center mb-3`}>
        <Icon className={`w-4 h-4 ${c.icon}`} />
      </div>
      <div className="text-2xl font-bold text-white">
        {value}
        {suffix && <span className="text-sm text-slate-500 font-normal ml-0.5">{suffix}</span>}
      </div>
      <div className="text-xs text-slate-500 mt-0.5 font-medium">{label}</div>
    </div>
  );
}
