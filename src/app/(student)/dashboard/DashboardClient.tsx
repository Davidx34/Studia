'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { BookOpen, Trophy, Target, Map, Sparkles, ArrowRight, CheckCircle2, Flame, ClipboardList } from 'lucide-react';
import type { RemediationPlan } from '@/lib/actions/remediation-plans';
import { ReviewTodayCard } from '@/components/student/ReviewTodayCard';
import type { ReviewPlanForDashboard } from '@/lib/study/reviewPlanServer';
import type { StreakStatus } from '@/lib/streak/status';
import { CinematicScene } from '@/components/cinematics/CinematicScene';
import { Card, Badge } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn } from '@/components/ui/cn';

interface Props {
  profile: any;
  inProgressModule: any;
  nextModule: { id: string; title: string; classroomId: string; classroomName: string } | null;
  missions: any[];
  recentAchievements: any[];
  totalCompleted: number;
  weeklyProgress: { date: string; count: number }[];
  activePlan: RemediationPlan | null;
  // Flashcards pendientes de repaso hoy (null si no hay o no se pudo calcular).
  reviewPlan?: ReviewPlanForDashboard | null;
  // Racha real y su estado (a salvo / en riesgo / dia de gracia / perdida).
  streak: StreakStatus;
  // "Mis clases": se muestra DESPUES de la accion principal (continuar), no antes.
  classesSection?: React.ReactNode;
}

export function DashboardClient({
  profile,
  inProgressModule,
  nextModule,
  missions,
  recentAchievements,
  totalCompleted,
  weeklyProgress,
  activePlan,
  reviewPlan,
  streak,
  classesSection,
}: Props) {
  const showMessage = useTonitoStore((s) => s.showMessage);
  const [showWelcome, setShowWelcome] = useState(false);

  // Cinematica de bienvenida: una vez cada vez que el estudiante ABRE la app (sesion del navegador), no en cada visita al dashboard.
  // sessionStorage vive mientras la pestaña o la app instalada siguen abiertas y se borra al cerrarlas; al volver a abrirla, se muestra otra vez.
  // Si el navegador lo bloquea, no se muestra: es mejor no repetirla en cada navegacion que repetirla sin parar.
  useEffect(() => {
    if (!profile?.id) return;
    try {
      const key = `studia_welcome_session_${profile.id}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        setShowWelcome(true);
      }
    } catch {
      /* sin sessionStorage: no se muestra */
    }
  }, [profile?.id]);

  // Toñito saluda al cargar el dashboard, contextual a la hora y al streak
  useEffect(() => {
    if (showWelcome) return;
    const hour = new Date().getHours();
    const timeGreeting =
      hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
    const name = profile?.full_name?.split(' ')[0] || profile?.username || 'estudiante';

    let message = '';
    if (streak.streak >= 7) {
      message = `¡${timeGreeting}, ${name}! 🔥 ${streak.streak} días seguidos. ¡Eres imparable!`;
    } else if (streak.streak >= 3) {
      message = `¡${timeGreeting}, ${name}! Llevas ${streak.streak} días. ¡Sigamos! 💪`;
    } else if (inProgressModule) {
      message = `¡${timeGreeting}, ${name}! Tienes un módulo a medias. ¿Lo terminamos? 📚`;
    } else {
      message = `¡${timeGreeting}, ${name}! ¿Listo para una nueva aventura? 🚀`;
    }

    const timer = setTimeout(() => showMessage(message, 6000), 800);
    return () => clearTimeout(timer);
  }, [profile, inProgressModule, showMessage, showWelcome, streak.streak]);

  const completedMissions = missions.filter((m) => m.is_completed).length;

  if (showWelcome) {
    const name = profile?.full_name?.split(' ')[0] || profile?.username || 'estudiante';
    return <CinematicScene type="welcome" studentName={name} onComplete={() => setShowWelcome(false)} />;
  }

  const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
  const heroHref = inProgressModule ? `/lesson/${inProgressModule.module_id}` : nextModule ? `/lesson/${nextModule.id}` : '/map';
  const heroLabel = inProgressModule ? 'Continúa donde lo dejaste' : nextModule ? `Siguiente en ${nextModule.classroomName}` : 'Empieza tu día';
  const heroTitle = inProgressModule?.content_modules?.title || nextModule?.title || 'Explora el mapa de aprendizaje';

  return (
    <div className="space-y-6 premium-fade-in-up">
      {/* Plan de refuerzo activo (Sesion E.2): no obligatorio, a su ritmo */}
      {activePlan && (
        <Link href={`/repaso/${activePlan.id}`} className={cn('block group rounded-2xl', focusRing)}>
          <Card interactive className="p-4 sm:p-5 flex items-center gap-4 bg-primary/10 border-primary/30">
            <div className="w-11 h-11 rounded-xl bg-primary text-on-primary flex items-center justify-center flex-shrink-0">
              <ClipboardList className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary-text">Mi próximo</div>
              <div className="text-fg font-bold truncate">{activePlan.title}</div>
              <div className="flex items-center gap-2 mt-1.5">
                <ProgressBar
                  className="max-w-[180px]"
                  label="Módulos completados del plan"
                  value={(activePlan.modules_completed / Math.max(1, activePlan.modules_target)) * 100}
                />
                <span className="text-xs text-fg-muted font-medium">
                  {activePlan.modules_completed}/{activePlan.modules_target} módulos completados
                </span>
              </div>
            </div>
            <ArrowRight className="w-6 h-6 text-fg-muted group-hover:translate-x-1 transition-transform motion-reduce:transform-none flex-shrink-0" aria-hidden="true" />
          </Card>
        </Link>
      )}

      {/* Tarjeta principal: Continuar / Siguiente modulo / Empezar. Es LA accion primaria de la pantalla. */}
      <Link href={heroHref} className={cn('block group rounded-3xl', focusRing)}>
        <div className="relative overflow-hidden rounded-3xl bg-primary text-on-primary p-6 sm:p-8 shadow-card transition-transform duration-200 motion-reduce:transition-none group-hover:scale-[1.01] motion-reduce:group-hover:scale-100">
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/15 blur-3xl" aria-hidden="true" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider mb-2 text-on-primary/90">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                {heroLabel}
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-3 text-balance">{heroTitle}</h2>
              {inProgressModule && (
                <div className="flex items-center gap-3">
                  <div
                    role="progressbar"
                    aria-label="Avance del módulo"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={inProgressModule.completion_percentage}
                    className="flex-1 max-w-xs h-2 rounded-full bg-white/25 overflow-hidden"
                  >
                    <div className="h-full rounded-full bg-white" style={{ width: `${inProgressModule.completion_percentage}%` }} />
                  </div>
                  <span className="text-sm font-semibold">{inProgressModule.completion_percentage}%</span>
                </div>
              )}
            </div>
            <ArrowRight className="w-8 h-8 flex-shrink-0 group-hover:translate-x-1 transition-transform motion-reduce:transform-none" aria-hidden="true" />
          </div>
        </div>
      </Link>

      <ReviewTodayCard plan={reviewPlan ?? null} />

      {classesSection}

      {/* Grid de stats rapidas */}
      <section aria-label="Tu resumen">
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={BookOpen} label="Módulos" value={totalCompleted} tone="primary" />
          <StatCard icon={Flame} label="Racha" value={`${streak.streak}d`} tone="accent" hint={streak.hint} />
          <StatCard icon={Trophy} label="Logros" value={recentAchievements.length} tone="primary" />
          <StatCard icon={Target} label="Misiones hoy" value={`${completedMissions}/${missions.length}`} tone="primary" />
        </ul>
      </section>

      {/* Progreso semanal */}
      <WeeklyProgressChart data={weeklyProgress} />

      {/* Misiones del día */}
      <section aria-labelledby="misiones-titulo">
        <div className="flex items-center justify-between mb-3">
          <h3 id="misiones-titulo" className="text-lg font-bold text-fg flex items-center gap-2">
            <Target className="w-5 h-5 text-primary-text" aria-hidden="true" /> Misiones de hoy
          </h3>
          <span className="text-xs text-fg-muted font-medium">
            {completedMissions}/{missions.length} completadas
          </span>
        </div>

        <div className="space-y-2">
          {missions.length === 0 && (
            <Card className="text-center py-6 text-fg-muted text-sm shadow-none">No hay misiones disponibles hoy. ¡Vuelve mañana!</Card>
          )}
          {missions.map((mission) => {
            const m = mission.daily_missions;
            const progress = Math.min(100, (mission.current_progress / m.target_value) * 100);
            return (
              <Card key={mission.id} className={cn('p-4 shadow-none', mission.is_completed && 'bg-success/10 border-success/40')}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {mission.is_completed && <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" aria-hidden="true" />}
                    <span className="font-semibold text-fg truncate">{m.title}</span>
                    {mission.is_completed && <span className="sr-only">(completada)</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs flex-shrink-0">
                    <span className="text-accent-text font-bold">+{m.reward_coins} monedas</span>
                  </div>
                </div>
                <ProgressBar label={`Progreso de la misión ${m.title}`} value={progress} tone={mission.is_completed ? 'success' : 'primary'} className="h-1.5" />
                <div className="flex justify-between text-xs text-fg-muted mt-1">
                  <span>{m.description}</span>
                  <span>
                    {mission.current_progress}/{m.target_value}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Logros recientes */}
      {recentAchievements.length > 0 && (
        <section aria-labelledby="logros-titulo">
          <h3 id="logros-titulo" className="text-lg font-bold text-fg flex items-center gap-2 mb-3">
            <Trophy className="w-5 h-5 text-accent-text" aria-hidden="true" /> Logros recientes
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {recentAchievements.map((ua) => {
              const a = ua.achievements;
              return (
                <Card key={ua.id} className="p-4 text-center relative overflow-hidden shadow-none">
                  {!ua.seen_by_user && (
                    <Badge tone="accent" className="absolute top-2 right-2 text-[10px] font-bold">
                      ¡NUEVO!
                    </Badge>
                  )}
                  <div
                    className="w-12 h-12 mx-auto mb-2 rounded-full flex items-center justify-center text-2xl"
                    style={{ background: a.color, boxShadow: `0 0 20px ${a.color}80` }}
                    aria-hidden="true"
                  >
                    🏆
                  </div>
                  <div className="font-bold text-sm text-fg truncate">{a.name}</div>
                  <div className="text-xs text-fg-muted mt-1 line-clamp-2">{a.description}</div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* CTA al mapa. Antes decia "15 módulos esperándote en 5 categorías": un texto fijo que no era cierto. */}
      <Link href="/map" className={cn('block group rounded-2xl', focusRing)}>
        <Card interactive className="p-5 flex items-center justify-between">
          <div>
            <div className="font-bold text-fg text-lg">Explorar el mapa</div>
            <div className="text-sm text-fg-muted">Mira todos tus módulos y elige por dónde seguir</div>
          </div>
          <Map className="w-8 h-8 text-primary-text group-hover:rotate-12 transition-transform motion-reduce:transform-none" aria-hidden="true" />
        </Card>
      </Link>
    </div>
  );
}

function WeeklyProgressChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const dayLabels = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const summary = data.map((d) => `${dayLabels[new Date(d.date + 'T00:00:00').getDay()]}: ${d.count}`).join(', ');

  return (
    <Card className="p-4 shadow-none">
      <h3 className="text-sm font-bold text-fg-muted mb-3 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary-text" aria-hidden="true" /> Módulos completados esta semana
      </h3>
      {/* Una grafica por si sola no la leen los lectores de pantalla: se resume en texto. */}
      <div role="img" aria-label={`Módulos completados por día. ${summary}`} className="flex items-end justify-between gap-2 h-20">
        {data.map((d) => {
          const h = Math.max(4, (d.count / max) * 100);
          const label = dayLabels[new Date(d.date + 'T00:00:00').getDay()];
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end h-16">
                <div className={cn('w-full rounded-t-md transition-[height] motion-reduce:transition-none', d.count > 0 ? 'bg-primary' : 'bg-surface-2')} style={{ height: `${h}%` }} />
              </div>
              <span className="text-[11px] text-fg-muted">{label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: any;
  label: string;
  value: string | number;
  tone: 'primary' | 'accent';
  hint?: string;
}) {
  return (
    <li>
      <Card className="p-4 h-full">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-2', tone === 'accent' ? 'bg-accent/20 text-accent-text' : 'bg-primary/15 text-primary-text')}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="text-2xl font-bold text-fg font-mono tabular-nums">{value}</div>
        <div className="text-xs text-fg-muted font-medium">{label}</div>
        {hint && <div className="mt-1 text-[11px] leading-snug text-fg-muted">{hint}</div>}
      </Card>
    </li>
  );
}
