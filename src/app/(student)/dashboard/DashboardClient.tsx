'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { BookOpen, Trophy, Target, Map, Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react';

interface Props {
  profile: any;
  inProgressModule: any;
  missions: any[];
  recentAchievements: any[];
  totalCompleted: number;
}

export function DashboardClient({
  profile,
  inProgressModule,
  missions,
  recentAchievements,
  totalCompleted,
}: Props) {
  const showMessage = useTonitoStore((s) => s.showMessage);

  // Toñito saluda al cargar el dashboard, contextual a la hora y al streak
  useEffect(() => {
    const hour = new Date().getHours();
    const timeGreeting =
      hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
    const name = profile?.full_name?.split(' ')[0] || profile?.username || 'estudiante';

    let message = '';
    if (profile?.streak_days >= 7) {
      message = `¡${timeGreeting}, ${name}! 🔥 ${profile.streak_days} días seguidos. ¡Eres imparable!`;
    } else if (profile?.streak_days >= 3) {
      message = `¡${timeGreeting}, ${name}! Llevas ${profile.streak_days} días. ¡Sigamos! 💪`;
    } else if (inProgressModule) {
      message = `¡${timeGreeting}, ${name}! Tienes un módulo a medias. ¿Lo terminamos? 📚`;
    } else {
      message = `¡${timeGreeting}, ${name}! ¿Listo para una nueva aventura? 🚀`;
    }

    const timer = setTimeout(() => showMessage(message, 6000), 800);
    return () => clearTimeout(timer);
  }, [profile, inProgressModule, showMessage]);

  const completedMissions = missions.filter((m) => m.is_completed).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero card: Continuar / Empezar */}
      <Link
        href={inProgressModule ? `/lesson/${inProgressModule.module_id}` : '/map'}
        className="block group"
      >
        <div className="relative overflow-hidden rounded-3xl backdrop-blur-2xl bg-white/15 border border-white/25 p-6 sm:p-8 hover:bg-white/20 hover:scale-[1.01] transition-all shadow-2xl">
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-yellow-300/20 rounded-full blur-3xl group-hover:bg-yellow-300/30 transition-colors" />

          <div className="relative flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-yellow-200 text-sm font-semibold uppercase tracking-wider mb-2">
                <Sparkles className="w-4 h-4" />
                {inProgressModule ? 'Continúa donde lo dejaste' : 'Empieza tu día'}
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2 truncate">
                {inProgressModule?.content_modules?.title || 'Explora el mapa de aprendizaje'}
              </h2>
              {inProgressModule && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 max-w-xs h-2 bg-white/15 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-yellow-300 to-orange-400"
                      style={{ width: `${inProgressModule.completion_percentage}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-white/80">
                    {inProgressModule.completion_percentage}%
                  </span>
                </div>
              )}
            </div>
            <ArrowRight className="w-8 h-8 text-white/70 group-hover:translate-x-1 transition-transform flex-shrink-0" />
          </div>
        </div>
      </Link>

      {/* Grid de stats rápidas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={BookOpen} label="Módulos" value={totalCompleted} color="from-cyan-400 to-blue-500" />
        <StatCard icon={Trophy} label="Logros" value={recentAchievements.length} color="from-yellow-400 to-orange-500" />
        <StatCard icon={Target} label="Misiones hoy" value={`${completedMissions}/${missions.length}`} color="from-pink-400 to-rose-500" />
        <StatCard icon={Map} label="Nivel" value={profile?.current_level || 1} color="from-violet-400 to-purple-600" />
      </div>

      {/* Misiones del día */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-pink-300" /> Misiones de hoy
          </h3>
          <span className="text-xs text-white/60 font-medium">
            {completedMissions}/{missions.length} completadas
          </span>
        </div>

        <div className="space-y-2">
          {missions.length === 0 && (
            <div className="text-center py-6 text-white/50 text-sm bg-white/5 rounded-2xl border border-white/10">
              No hay misiones disponibles hoy. ¡Vuelve mañana!
            </div>
          )}
          {missions.map((mission) => {
            const m = mission.daily_missions;
            const progress = Math.min(100, (mission.current_progress / m.target_value) * 100);
            return (
              <div
                key={mission.id}
                className={`backdrop-blur-xl border rounded-2xl p-4 transition ${
                  mission.is_completed
                    ? 'bg-emerald-500/20 border-emerald-400/40'
                    : 'bg-white/10 border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {mission.is_completed && <CheckCircle2 className="w-5 h-5 text-emerald-300 flex-shrink-0" />}
                    <span className="font-semibold text-white truncate">{m.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs flex-shrink-0">
                    <span className="text-yellow-300 font-bold">+{m.reward_coins}🪙</span>
                    <span className="text-purple-300 font-bold">+{m.reward_xp}⚡</span>
                  </div>
                </div>
                <div className="h-1.5 bg-black/20 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 ${
                      mission.is_completed
                        ? 'bg-emerald-400'
                        : 'bg-gradient-to-r from-pink-400 to-rose-500'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-white/60 mt-1">
                  <span>{m.description}</span>
                  <span>
                    {mission.current_progress}/{m.target_value}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Logros recientes */}
      {recentAchievements.length > 0 && (
        <section>
          <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
            <Trophy className="w-5 h-5 text-yellow-300" /> Logros recientes
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {recentAchievements.map((ua) => {
              const a = ua.achievements;
              return (
                <div
                  key={ua.id}
                  className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4 text-center hover:bg-white/15 transition relative overflow-hidden"
                >
                  {!ua.seen_by_user && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 bg-yellow-400 text-yellow-900 text-[10px] font-bold rounded-full">
                      ¡NUEVO!
                    </span>
                  )}
                  <div
                    className="w-12 h-12 mx-auto mb-2 rounded-full flex items-center justify-center text-2xl"
                    style={{ background: a.color, boxShadow: `0 0 20px ${a.color}80` }}
                  >
                    🏆
                  </div>
                  <div className="font-bold text-sm text-white truncate">{a.name}</div>
                  <div className="text-xs text-white/60 mt-1 line-clamp-2">{a.description}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* CTA al mapa */}
      <Link
        href="/map"
        className="block backdrop-blur-xl bg-gradient-to-r from-violet-500/30 to-cyan-500/30 border border-white/20 rounded-2xl p-5 hover:scale-[1.01] transition group"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-white text-lg">Explorar el mapa</div>
            <div className="text-sm text-white/70">
              15 módulos esperándote en 5 categorías
            </div>
          </div>
          <Map className="w-8 h-8 text-white group-hover:rotate-12 transition-transform" />
        </div>
      </Link>

      <style jsx>{`
        @keyframes fade-in {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.5s ease-out; }
      `}</style>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-4 hover:bg-white/15 transition">
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-2 shadow-lg`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-white/60 font-medium">{label}</div>
    </div>
  );
}
