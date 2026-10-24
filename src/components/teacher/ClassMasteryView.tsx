import { AlertCircle, Target } from 'lucide-react';
import { MASTERY_LABELS, MASTERY_THRESHOLD, MIN_EVIDENCE, type MasteryCounts } from '@/lib/mastery/mastery';
import type { ClassMastery, ModuleRollup } from '@/lib/mastery/classMastery';
import { MASTERY_ICON, MASTERY_ORDER, SegmentedBar } from '@/components/mastery/SegmentedBar';

const panel = 'rounded-2xl border border-line shadow-card bg-surface p-5';

const studentsWord = (n: number) => (n === 1 ? '1 estudiante' : `${n} estudiantes`);

// Lista de conteos con icono y texto (el color nunca es el unico mensaje).
function CountsLegend({ counts }: { counts: MasteryCounts }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg">
      {MASTERY_ORDER.map((s) => {
        const Icon = MASTERY_ICON[s];
        return (
          <li key={s} className="inline-flex items-center gap-1.5">
            <Icon aria-hidden="true" className="w-3.5 h-3.5 text-fg-muted" />
            <span className="tabular-nums font-medium">{counts[s]}</span> {MASTERY_LABELS[s].toLowerCase()}
          </li>
        );
      })}
    </ul>
  );
}

// Quienes estan en cada estado de un modulo, para poder actuar (hablar con ellos, asignar un plan de refuerzo...).
function WhoList({ m }: { m: ModuleRollup }) {
  const states = MASTERY_ORDER.filter((s) => m.students[s].length > 0);
  return (
    <details className="mt-2 group">
      <summary className="inline-flex items-center min-h-[44px] cursor-pointer text-xs font-semibold text-primary-text underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
        Ver quiénes
      </summary>
      <dl className="mt-2 space-y-2 text-xs">
        {states.map((s) => (
          <div key={s}>
            <dt className="font-semibold text-fg">
              {MASTERY_LABELS[s]} ({m.students[s].length})
            </dt>
            <dd className="text-fg-muted">{m.students[s].map((x) => x.name).join(', ')}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ModuleRow({ m }: { m: ModuleRollup }) {
  return (
    <li className="space-y-1.5">
      <h4 className="text-sm font-medium text-fg">{m.title}</h4>
      <SegmentedBar counts={m.counts} label={`Dominio de ${m.title}`} />
      <CountsLegend counts={m.counts} />
      {(m.counts.needs_review > 0 || m.counts.mastered > 0 || m.counts.in_progress > 0) && <WhoList m={m} />}
    </li>
  );
}

function Attention({ items }: { items: ModuleRollup[] }) {
  return (
    <section aria-labelledby="donde-intervenir" className={`${panel} border-accent/40`}>
      <h3 id="donde-intervenir" className="flex items-center gap-2 text-fg font-semibold">
        <Target aria-hidden="true" className="w-4 h-4 text-accent-text" /> Dónde intervenir
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted mt-2">Ningún estudiante tiene módulos por repasar. Buen momento para avanzar.</p>
      ) : (
        <>
          <p className="text-sm text-fg-muted mt-1">Módulos con más estudiantes que, con una lección completa respondida, aún no llegan al {Math.round(MASTERY_THRESHOLD * 100)} % de aciertos.</p>
          <ol className="mt-3 space-y-3">
            {items.map((m) => (
              <li key={m.moduleId} className="space-y-1">
                <p className="text-sm font-medium text-fg">
                  {m.title} <span className="font-normal text-fg-muted">· {studentsWord(m.counts.needs_review)} por repasar de {m.counts.total}</span>
                </p>
                <p className="text-xs text-fg-muted">{m.students.needs_review.map((s) => s.name).join(', ')}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export function ClassMasteryView({ mastery, truncated = false, error = null }: { mastery: ClassMastery | null; truncated?: boolean; error?: string | null }) {
  if (error || !mastery) {
    return (
      <div role="alert" className="rounded-2xl bg-danger/10 border border-danger/30 p-4 flex items-start gap-2 text-sm text-danger">
        <AlertCircle aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{error ?? 'No se pudo calcular el dominio de la clase.'}</span>
      </div>
    );
  }
  if (mastery.students === 0) {
    return <div className={`${panel} text-center text-sm text-fg-muted`}>Aún no hay estudiantes inscritos en esta clase.</div>;
  }
  if (mastery.groups.length === 0) {
    return <div className={`${panel} text-center text-sm text-fg-muted`}>Esta clase aún no tiene módulos.</div>;
  }
  if (!mastery.hasData) {
    return <div className={`${panel} text-center text-sm text-fg-muted`}>Aún no hay respuestas de tus estudiantes en estos módulos. Cuando empiecen, aquí verás quién domina qué.</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-fg-muted">
        De cada pregunta cuenta la última vez que el estudiante la respondió. Con menos de {MIN_EVIDENCE} preguntas distintas en un módulo se considera «en progreso»; con {MIN_EVIDENCE} o más,
        a partir de {Math.round(MASTERY_THRESHOLD * 100)} % de aciertos es «dominado» y por debajo «por repasar». Los umbrales son provisionales. Quien no ha empezado cuenta como «sin empezar».
      </p>

      {truncated && (
        <p role="status" className="rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm text-fg">
          Esta clase tiene tantas respuestas que se leyeron solo las más recientes: los números pueden estar incompletos.
        </p>
      )}

      <Attention items={mastery.attention} />

      {mastery.groups.map((g) => (
        <section key={g.objective?.id ?? 'sin-objetivo'} aria-labelledby={`dom-${g.objective?.id ?? 'sin-objetivo'}`} className={`${panel} space-y-4`}>
          <div className="space-y-1.5">
            <h3 id={`dom-${g.objective?.id ?? 'sin-objetivo'}`} className="text-fg font-semibold">
              {g.objective ? g.objective.title : 'Módulos sin objetivo asignado'}
            </h3>
            {g.studentCounts && (
              <>
                <p className="text-xs text-fg-muted">Estudiantes según el objetivo completo (dominado solo si domina todos sus módulos)</p>
                <SegmentedBar counts={g.studentCounts} label={`Dominio del objetivo ${g.objective?.title}`} />
                <CountsLegend counts={g.studentCounts} />
              </>
            )}
          </div>
          <ul className="space-y-5 border-t border-line pt-4">
            {g.modules.map((m) => (
              <ModuleRow key={m.moduleId} m={m} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

