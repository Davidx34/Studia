// Sección "Mis clases" arriba del dashboard global del estudiante
// Fase 11.F · Stud.ia
//
// Server component. No toca DashboardClient (legacy) — se renderiza encima.

import Link from 'next/link';
import { GraduationCap, ChevronRight, BookOpen } from 'lucide-react';
import { Card, Badge } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';

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
      <Card className="p-4 mb-6 shadow-none">
        <header className="flex items-center gap-2 mb-2">
          <BookOpen className="w-5 h-5 text-fg-muted" aria-hidden="true" />
          <h2 className="text-base font-semibold text-fg">Mis clases</h2>
        </header>
        <p className="text-sm text-fg-muted">Tu profesor te invitará a tus clases. Cuando lo haga, las verás acá.</p>
      </Card>
    );
  }

  return (
    <section className="mb-6" aria-labelledby="mis-clases-titulo">
      <header className="flex items-center gap-2 mb-3">
        <GraduationCap className="w-5 h-5 text-primary-text" aria-hidden="true" />
        <h2 id="mis-clases-titulo" className="text-lg font-bold text-fg">
          Mis clases
        </h2>
        <span className="text-sm text-fg-muted">({classes.length})</span>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {classes.map((c) => {
          const pct = c.modulesTotal > 0 ? Math.round((c.modulesCompleted / c.modulesTotal) * 100) : 0;
          return (
            <li key={c.classroomId}>
              <Link
                href={`/my-classes/${c.classroomId}`}
                className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                <Card interactive className="h-full p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary-text flex items-center justify-center">
                      <GraduationCap className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <ChevronRight className="w-4 h-4 text-fg-muted group-hover:text-fg transition-colors" aria-hidden="true" />
                  </div>

                  <h3 className="text-sm font-semibold text-fg truncate">{c.name}</h3>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.subjectArea && <Badge className="uppercase tracking-wider text-[10px]">{c.subjectArea}</Badge>}
                    {c.gradeLevel && <Badge className="uppercase tracking-wider text-[10px]">{c.gradeLevel}</Badge>}
                  </div>
                  <p className="text-xs text-fg-muted mt-2">Prof. {c.teacherName}</p>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-fg-muted mb-1">
                      <span>Progreso</span>
                      <span>
                        {c.modulesCompleted}/{c.modulesTotal} ({pct}%)
                      </span>
                    </div>
                    <ProgressBar value={pct} label={`Progreso en ${c.name}`} tone="success" className="h-1.5" />
                  </div>

                  <div className="mt-3 text-sm text-primary-text font-medium">Continuar →</div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
