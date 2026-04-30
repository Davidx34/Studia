'use client';

// Vista de mapa de clase para el estudiante (Fase 11.D)
// Diseño: lista vertical de "estaciones" con estados (locked/available/in_progress/completed).
// No reutiliza LearningMap del mapa global para evitar acoplar modelos.

import Link from 'next/link';
import { Lock, CheckCircle2, Play, BookOpen } from 'lucide-react';
import type { ContentModule, StudentProgress } from '@/types/database';

type NodeStatus = 'locked' | 'available' | 'in_progress' | 'completed';

export default function ClassroomMap({
  modules,
  progress,
}: {
  modules: ContentModule[];
  progress: Record<string, StudentProgress>;
}) {
  if (modules.length === 0) {
    return (
      <div className="text-center py-16 rounded-2xl bg-white/5 border border-white/10 border-dashed">
        <BookOpen className="w-10 h-10 text-white/40 mx-auto mb-2" />
        <p className="text-white/70">
          Tu profesor todavía no ha generado el mapa de esta clase.
        </p>
        <p className="text-xs text-white/50 mt-1">
          Vuelve más tarde — aparecerá automáticamente cuando esté listo.
        </p>
      </div>
    );
  }

  const completedSet = new Set(
    Object.values(progress)
      .filter((p) => p.status === 'completed')
      .map((p) => p.module_id)
  );

  const byId = new Map(modules.map((m) => [m.id, m]));

  function getStatus(m: ContentModule): NodeStatus {
    const p = progress[m.id];
    if (p?.status === 'completed') return 'completed';
    if (p?.status === 'in_progress') return 'in_progress';
    // ¿Prereqs cumplidos?
    const prereqs = (m.prerequisites as string[]) ?? [];
    if (prereqs.length === 0) return 'available';
    const allDone = prereqs.every((id) => completedSet.has(id));
    return allDone ? 'available' : 'locked';
  }

  const completedCount = modules.filter((m) => getStatus(m) === 'completed').length;
  const totalCount = modules.length;
  const pct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/20 p-4">
        <div className="flex justify-between items-center text-sm text-white mb-2">
          <span className="font-medium">Progreso de la clase</span>
          <span className="text-white/80">
            {completedCount} / {totalCount} ({pct}%)
          </span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-violet-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Lista de módulos como estaciones */}
      <ol className="space-y-3">
        {modules.map((m, idx) => {
          const status = getStatus(m);
          return <ModuleStation key={m.id} module={m} idx={idx} status={status} />;
        })}
      </ol>
    </div>
  );
}

function ModuleStation({
  module,
  idx,
  status,
}: {
  module: ContentModule;
  idx: number;
  status: NodeStatus;
}) {
  const isLocked = status === 'locked';
  const isCompleted = status === 'completed';
  const isInProgress = status === 'in_progress';

  const stateClasses = isLocked
    ? 'bg-slate-900/40 border-white/10 text-white/40'
    : isCompleted
      ? 'bg-emerald-500/15 border-emerald-400/40 text-white'
      : isInProgress
        ? 'bg-amber-500/15 border-amber-400/40 text-white'
        : 'bg-white/10 border-white/25 text-white hover:bg-white/15';

  const Icon = isLocked
    ? Lock
    : isCompleted
      ? CheckCircle2
      : isInProgress
        ? Play
        : Play;

  const content = (
    <div className={`rounded-2xl border-2 p-4 transition ${stateClasses}`}>
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center font-mono text-sm flex-shrink-0 ${
            isLocked
              ? 'bg-slate-800/60 text-white/40'
              : isCompleted
                ? 'bg-emerald-500/30 text-emerald-200'
                : 'bg-white/20 text-white'
          }`}
        >
          {isLocked ? <Lock className="w-4 h-4" /> : idx + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{module.title}</h3>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 border border-white/15">
              Dif {module.difficulty_level}
            </span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 border border-white/15">
              {module.estimated_time_minutes} min
            </span>
          </div>
          {module.description && (
            <p className="text-sm opacity-80 mt-1 line-clamp-2">{module.description}</p>
          )}
          {isLocked && (
            <p className="text-xs mt-2 opacity-70">
              Completa los módulos anteriores para desbloquear.
            </p>
          )}
          {isInProgress && (
            <p className="text-xs mt-2 text-amber-200">En progreso</p>
          )}
        </div>
        {!isLocked && <Icon className="w-5 h-5 flex-shrink-0 mt-1" />}
      </div>
    </div>
  );

  if (isLocked) return <li>{content}</li>;

  return (
    <li>
      <Link href={`/lesson/${module.id}`} className="block">
        {content}
      </Link>
    </li>
  );
}
