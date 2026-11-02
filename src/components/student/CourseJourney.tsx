import Link from 'next/link';
import { CheckCircle2, Clock, Lock, Play } from 'lucide-react';
import { Badge, Card, type BadgeTone } from '@/components/ui/Card';
import type { CourseView, ExamState, ModuleState } from '@/lib/blueprint/studentView';

// Recorrido del curso por cortes (solo lectura). Cada estado lleva ICONO y TEXTO, no solo color. No bloquea nada: el mapa de modulos de la clase sigue funcionando igual.
const MODULE_STATE: Record<ModuleState, { label: string; tone: BadgeTone; icon: typeof Lock }> = {
  mastered: { label: 'Dominado', tone: 'success', icon: CheckCircle2 },
  available: { label: 'Te toca', tone: 'primary', icon: Play },
  locked: { label: 'Bloqueado', tone: 'neutral', icon: Lock },
  pendingContent: { label: 'Pendiente de contenido', tone: 'accent', icon: Clock },
};
const EXAM_STATE: Record<ExamState, string> = {
  locked: 'Se desbloquea al dominar los módulos',
  available: 'Desbloqueada',
  mastered: 'Dominada',
};

const fmt = (n: number | null) => (n === null ? '—' : `${Math.round(n * 10) / 10} %`);
const linkBtn =
  'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

// classroomId: con el, las evaluaciones desbloqueadas llevan a su pantalla; sin el, solo se muestra su estado.
export function CourseJourney({ view, className, version, scoresAvailable, classroomId }: { view: CourseView; className: string; version: number; scoresAvailable: boolean; classroomId?: string }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-fg text-balance">Recorrido del curso</h1>
        <p className="mt-1 text-fg-muted">
          {className} · plan versión {version}
        </p>
      </header>

      <Card className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <div>
            <p className="text-sm text-fg-muted">Tu nota hasta ahora</p>
            <p className="text-3xl font-bold text-fg">{fmt(view.grade.average)}</p>
          </div>
          <div>
            <p className="text-sm text-fg-muted">Módulos dominados</p>
            <p className="text-3xl font-bold text-fg">
              {view.totals.mastered} <span className="text-lg font-normal text-fg-muted">de {view.totals.modules}</span>
            </p>
          </div>
        </div>
        <p className="text-sm text-fg-muted">
          La nota se va calculando a medida que avanzas: lo que todavía no has hecho no cuenta como cero. Cada intento cuenta (la nota de un módulo es el promedio de sus intentos) y pasas al siguiente módulo cuando logras 100 %.
        </p>
        <p className="rounded-xl border border-line bg-surface-2 p-3 text-sm font-semibold text-fg [overflow-wrap:anywhere]" role="status">
          {view.next.text}
        </p>
        {!scoresAvailable && <p className="text-sm text-danger">No pudimos leer tus intentos en este momento: los módulos se muestran sin nota. Intenta de nuevo más tarde.</p>}
        <p className="text-xs text-fg-muted">Esta vista muestra tu recorrido. Por ahora puedes seguir usando el mapa de módulos de la clase como siempre.</p>
      </Card>

      {view.periods.map((p) => (
        <section key={p.id} aria-label={p.name} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-bold text-fg [overflow-wrap:anywhere]">{p.name}</h2>
            <p className="text-sm text-fg-muted">
              Vale {p.weight} % del curso · nota del corte: <span className="font-semibold text-fg">{fmt(p.result.score)}</span>
            </p>
          </div>
          <ul className="space-y-2">
            {p.modules.map((m) => {
              const st = MODULE_STATE[m.state];
              const Icon = st.icon;
              const open = m.moduleId !== null && (m.state === 'available' || m.state === 'mastered');
              return (
                <li key={m.nodeId}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-fg [overflow-wrap:anywhere]">{m.title}</p>
                      <p className="text-sm text-fg-muted [overflow-wrap:anywhere]">
                        {m.objectiveTitle}
                        {m.attempts > 0 && ` · ${m.attempts} ${m.attempts === 1 ? 'intento' : 'intentos'} · nota ${fmt(m.score)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={st.tone}>
                        <Icon aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
                        {st.label}
                      </Badge>
                      {open && (
                        <Link href={`/lesson/${m.moduleId}`} className={`${linkBtn} ${m.state === 'available' ? 'bg-primary text-on-primary hover:brightness-110' : 'border border-line bg-surface-2 text-fg hover:border-line-strong'}`}>
                          {m.state === 'available' ? 'Abrir' : 'Repasar'}
                          <span className="sr-only"> {m.title}</span>
                        </Link>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          <p className="rounded-xl border border-dashed border-line p-3 text-sm text-fg-muted">
            <span className="font-semibold text-fg">Evaluación del corte</span> (vale 30 % del corte): {EXAM_STATE[p.exam.state]}
            {p.exam.attempts > 0 && ` · ${p.exam.attempts} ${p.exam.attempts === 1 ? 'intento' : 'intentos'} · nota ${fmt(p.exam.score)}`}
          </p>
          {p.exam.state === 'available' && classroomId && (
            <Link href={`/my-classes/${classroomId}/course/exam/${p.id}`} className={`${linkBtn} bg-primary text-on-primary hover:brightness-110`}>
              <Play aria-hidden="true" className="h-4 w-4" /> {p.exam.attempts > 0 ? 'Volver a intentar la evaluación' : 'Presentar la evaluación'}
              <span className="sr-only"> del corte {p.name}</span>
            </Link>
          )}
        </section>
      ))}

      <section aria-label="Evaluación final" className="space-y-2">
        <h2 className="text-xl font-bold text-fg">Evaluación final</h2>
        <p className="rounded-xl border border-dashed border-line p-3 text-sm text-fg-muted">
          Comprueba todo el curso y vale medio corte ({Math.round(view.finalExam.weight * 100) / 100} % del curso): {view.finalExam.state === 'locked' ? 'se desbloquea al terminar todos los cortes' : EXAM_STATE[view.finalExam.state]}
          {view.finalExam.attempts > 0 && ` · ${view.finalExam.attempts} ${view.finalExam.attempts === 1 ? 'intento' : 'intentos'} · nota ${fmt(view.finalExam.score)}`}
        </p>
        {view.finalExam.state === 'available' && classroomId && (
          <Link href={`/my-classes/${classroomId}/course/exam/final`} className={`${linkBtn} bg-primary text-on-primary hover:brightness-110`}>
            <Play aria-hidden="true" className="h-4 w-4" /> {view.finalExam.attempts > 0 ? 'Volver a intentar la evaluación final' : 'Presentar la evaluación final'}
          </Link>
        )}
      </section>
    </div>
  );
}
