// Sección "Mis clases" arriba del dashboard global del estudiante
// Fase 11.F · Stud.ia
//
// Server component. No toca DashboardClient (legacy) — se renderiza encima.

import Link from 'next/link';
import { GraduationCap, ChevronRight, BookOpen } from 'lucide-react';

export interface MyClassCard {
  classroomId: string;
  name: string;
  subjectArea: string | null;
  gradeLevel: string | null;
  teacherName: string;
  modulesCompleted: number;
  modulesTotal: number;
}

export default function MyClassesSection({ classes }: { classes: MyClassCard[] }) {
  if (classes.length === 0) {
    return (
      <section className="rounded-2xl bg-white/10 backdrop-blur border border-white/15 p-4 mb-6">
        <header className="flex items-center gap-2 mb-2">
          <BookOpen className="w-5 h-5 text-white/70" />
          <h2 className="text-base font-semibold text-white">Mis clases</h2>
        </header>
        <p className="text-sm text-white/70">
          Tu profesor te invitará a tus clases. Cuando lo haga, las verás acá.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <header className="flex items-center gap-2 mb-3">
        <span className="text-xl">📚</span>
        <h2 className="text-lg font-bold text-white">Mis clases</h2>
        <span className="text-sm text-white/60">({classes.length})</span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {classes.map((c) => {
          const pct =
            c.modulesTotal > 0 ? Math.round((c.modulesCompleted / c.modulesTotal) * 100) : 0;
          return (
            <Link
              key={c.classroomId}
              href={`/my-classes/${c.classroomId}`}
              className="group rounded-2xl bg-white/10 backdrop-blur border border-white/20 p-4 hover:bg-white/15 transition"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/30 border border-violet-300/40 flex items-center justify-center">
                  <GraduationCap className="w-5 h-5 text-white" />
                </div>
                <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-white transition" />
              </div>

              <h3 className="text-sm font-semibold text-white truncate">{c.name}</h3>
              <div className="flex flex-wrap gap-1 mt-1">
                {c.subjectArea && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/15 text-white/80 border border-white/10">
                    {c.subjectArea}
                  </span>
                )}
                {c.gradeLevel && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/15 text-white/80 border border-white/10">
                    {c.gradeLevel}
                  </span>
                )}
              </div>
              <p className="text-xs text-white/70 mt-2">Prof. {c.teacherName}</p>

              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] text-white/70 mb-1">
                  <span>Progreso</span>
                  <span>
                    {c.modulesCompleted}/{c.modulesTotal} ({pct}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-violet-400 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className="mt-3 text-xs text-white/90 font-medium group-hover:text-white">
                Continuar →
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
