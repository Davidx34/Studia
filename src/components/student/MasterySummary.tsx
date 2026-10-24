import Link from 'next/link';
import { Dumbbell } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { MASTERY_LABELS, objectiveState, rollupMastery, type MasteryState } from '@/lib/mastery/mastery';
import { MASTERY_ICON, MASTERY_ORDER, SegmentedBar } from '@/components/mastery/SegmentedBar';

export interface SummaryModule {
  id: string;
  objectiveId: string | null;
  state: MasteryState;
}

export interface SummaryObjective {
  id: string;
  title: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "Tu dominio": cuantos modulos domina, cuales debe repasar y como va cada objetivo. Solo se muestra si ya empezo algo.
export function MasterySummary({
  modules,
  objectives,
  practiceHref,
}: {
  modules: SummaryModule[];
  objectives: SummaryObjective[];
  // Si hay algo por repasar y ya puede practicar, se ofrece ir directo.
  practiceHref?: string | null;
}) {
  const counts = rollupMastery(modules.map((m) => m.state));
  if (counts.total === 0 || counts.not_started === counts.total) return null;

  const rows = objectives
    .map((o) => {
      const mods = modules.filter((m) => m.objectiveId === o.id);
      return { o, mods, state: objectiveState(mods.map((m) => m.state)), counts: rollupMastery(mods.map((m) => m.state)) };
    })
    .filter((r) => r.mods.length > 0);

  return (
    <Card className="p-5 space-y-4" role="region" aria-labelledby="tu-dominio">
      <div>
        <h2 id="tu-dominio" className="text-lg font-bold text-fg">
          Tu dominio
        </h2>
        <p className="text-sm text-fg-muted mt-1">
          Cuenta la última vez que respondiste cada pregunta: si antes fallaste y luego acertaste, ya la dominas.
        </p>
      </div>

      <div className="space-y-2">
        <SegmentedBar counts={counts} label="Dominio de los módulos de la clase" />
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg">
          {MASTERY_ORDER.map((s) => {
            const Icon = MASTERY_ICON[s];
            return (
              <li key={s} className="inline-flex items-center gap-1.5">
                <Icon aria-hidden="true" className="w-4 h-4 text-fg-muted" />
                <span className="tabular-nums font-medium">{counts[s]}</span> {MASTERY_LABELS[s].toLowerCase()}
              </li>
            );
          })}
        </ul>
      </div>

      {counts.needs_review > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg">
          <span>
            Tienes {plural(counts.needs_review, 'módulo', 'módulos')} por repasar.
          </span>
          {practiceHref && (
            <Link href={practiceHref} className="inline-flex items-center gap-1.5 min-h-[44px] font-semibold text-primary-text underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
              <Dumbbell aria-hidden="true" className="w-4 h-4" /> Practicar sin presión
            </Link>
          )}
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-fg-muted">Por objetivo de aprendizaje</h3>
          <ul className="space-y-3">
            {rows.map(({ o, mods, state, counts: c }) => (
              <li key={o.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-fg">{o.title}</span>
                  <span className="text-xs text-fg-muted tabular-nums whitespace-nowrap">
                    {c.mastered} de {mods.length} {mods.length === 1 ? 'módulo dominado' : 'módulos dominados'} · {MASTERY_LABELS[state]}
                  </span>
                </div>
                <SegmentedBar counts={c} label={`Dominio de ${o.title}`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
