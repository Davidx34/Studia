import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { ArrowLeft, Flame, Heart, Coins, Zap, TrendingUp } from 'lucide-react';

interface PageProps {
  params: Promise<{ studentId: string }>;
}

export default async function StudentDetailPage({ params }: PageProps) {
  const { studentId } = await params;
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verificar que este estudiante esté inscrito en alguna clase del profesor
  const { data: enrollment } = await supabase
    .from('class_enrollments')
    .select('id')
    .eq('teacher_id', user.id)
    .eq('student_id', studentId)
    .maybeSingle();

  if (!enrollment) notFound();

  // Cargar perfil del estudiante
  const { data: student } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', studentId)
    .single();

  if (!student) notFound();

  // Cargar todo el progreso
  const { data: progress } = await supabase
    .from('student_progress')
    .select('*, content_modules(title, category, difficulty_level)')
    .eq('student_id', studentId)
    .order('last_attempt_at', { ascending: false });

  const completed = progress?.filter((p) => p.status === 'completed') || [];
  const inProgress = progress?.filter((p) => p.status === 'in_progress') || [];

  // Stats por categoría
  const categories = ['math', 'science', 'language', 'history', 'logic'];
  const categoryStats = categories.map((cat) => {
    const cmp = completed.filter((p) => p.content_modules?.category === cat);
    const avg =
      cmp.length > 0
        ? Math.round(cmp.reduce((sum, p) => sum + (p.score || 0), 0) / cmp.length)
        : 0;
    return { category: cat, completed: cmp.length, avgScore: avg };
  });

  // Heatmap: últimos 28 días, un punto por día con conteo de actividad
  const today = new Date();
  const heatmapDays: { date: string; count: number; intensity: number }[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().split('T')[0];
    const count = (progress || []).filter((p) => {
      const lastAttempt = p.last_attempt_at?.split('T')[0];
      return lastAttempt === dStr;
    }).length;
    heatmapDays.push({
      date: dStr,
      count,
      intensity: count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3,
    });
  }

  const daysInactive = student.last_activity_date
    ? Math.floor(
        (today.getTime() - new Date(student.last_activity_date).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : 999;

  return (
    <div className="space-y-6">
      {/* Header con back */}
      <Link
        href="/teacher/students"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver a estudiantes
      </Link>

      {/* Perfil grande */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
            {student.full_name?.charAt(0) || student.username.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white">{student.full_name}</h1>
            <div className="text-slate-500 text-sm">@{student.username}</div>
            <div className="flex items-center gap-4 mt-3 text-sm">
              <span className="text-slate-400">
                Nivel <span className="text-white font-semibold">{student.current_level}</span>
              </span>
              <span className="text-slate-700">·</span>
              <span
                className={`font-semibold ${
                  daysInactive >= 3 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {daysInactive === 0
                  ? 'Activo hoy'
                  : daysInactive === 1
                  ? 'Activo ayer'
                  : `${daysInactive} días sin actividad`}
              </span>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          <Stat icon={Zap} label="XP totales" value={student.total_xp.toLocaleString()} accent="violet" />
          <Stat icon={Coins} label="Monedas" value={student.coins.toLocaleString()} accent="amber" />
          <Stat icon={Flame} label="Racha" value={`${student.streak_days}d`} accent="orange" />
          <Stat icon={Heart} label="Vidas" value={`${student.current_hearts}/${student.max_hearts}`} accent="rose" />
        </div>
      </div>

      {/* Layout dos columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Heatmap */}
        <section className="lg:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Actividad de los últimos 28 días</h3>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span>Menos</span>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-sm ${
                    i === 0
                      ? 'bg-slate-800'
                      : i === 1
                      ? 'bg-violet-500/30'
                      : i === 2
                      ? 'bg-violet-500/60'
                      : 'bg-violet-500'
                  }`}
                />
              ))}
              <span>Más</span>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {heatmapDays.map((day) => (
              <div
                key={day.date}
                title={`${day.date}: ${day.count} actividades`}
                className={`aspect-square rounded-md border ${
                  day.intensity === 0
                    ? 'bg-slate-800/50 border-slate-800'
                    : day.intensity === 1
                    ? 'bg-violet-500/30 border-violet-500/40'
                    : day.intensity === 2
                    ? 'bg-violet-500/60 border-violet-500/60'
                    : 'bg-violet-500 border-violet-400'
                } hover:scale-110 transition-transform cursor-default`}
              />
            ))}
          </div>
        </section>

        {/* Por categoría */}
        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
          <h3 className="font-semibold text-white mb-4">Rendimiento por categoría</h3>
          <div className="space-y-3">
            {categoryStats.map((cat) => {
              const labels: Record<string, { name: string; emoji: string }> = {
                math: { name: 'Matemáticas', emoji: '🔢' },
                science: { name: 'Ciencias', emoji: '🔬' },
                language: { name: 'Lenguaje', emoji: '📖' },
                history: { name: 'Historia', emoji: '📜' },
                logic: { name: 'Lógica', emoji: '🧩' },
              };
              return (
                <div key={cat.category}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{labels[cat.category].emoji}</span>
                      <span className="text-sm font-medium text-slate-300">
                        {labels[cat.category].name}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-slate-400">
                      {cat.completed > 0 ? `${cat.avgScore}/100` : '—'}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        cat.avgScore >= 80
                          ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                          : cat.avgScore >= 60
                          ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                          : cat.avgScore > 0
                          ? 'bg-gradient-to-r from-rose-500 to-pink-400'
                          : 'bg-slate-700'
                      }`}
                      style={{ width: `${cat.avgScore}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Actividad reciente */}
      <section>
        <h3 className="font-semibold text-white mb-3">Actividad reciente</h3>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 divide-y divide-slate-800">
          {[...inProgress, ...completed].slice(0, 8).map((p) => {
            const m = p.content_modules;
            return (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-white truncate">{m?.title}</div>
                  <div className="text-xs text-slate-500 capitalize">
                    {m?.category} · Nivel {m?.difficulty_level}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {p.status === 'completed' ? (
                    <span
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                        (p.score || 0) >= 80
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : (p.score || 0) >= 60
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      {p.score}/100
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 text-xs font-semibold rounded-md bg-violet-500/15 text-violet-300">
                      En progreso · {p.completion_percentage}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {completed.length === 0 && inProgress.length === 0 && (
            <div className="px-5 py-8 text-center text-slate-500 text-sm">
              Este estudiante aún no ha empezado ningún módulo.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  accent: 'violet' | 'amber' | 'orange' | 'rose';
}) {
  const colors = {
    violet: 'text-violet-300 bg-violet-500/10',
    amber: 'text-amber-300 bg-amber-500/10',
    orange: 'text-orange-300 bg-orange-500/10',
    rose: 'text-rose-300 bg-rose-500/10',
  };
  return (
    <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-3">
      <div className={`w-7 h-7 rounded-md ${colors[accent]} flex items-center justify-center mb-2`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
        {label}
      </div>
    </div>
  );
}
