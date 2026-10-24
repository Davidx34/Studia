'use client';

// "Asignar refuerzo" de un modulo (bloque «Dónde intervenir»). Dos pasos: vista previa (a quién y sobre qué conceptos) y
// confirmar. Un plan llega al inicio del estudiante y no se puede cancelar desde la pantalla, así que nunca se crea sin ver antes
// a quién y de qué.

import { useState } from 'react';
import { CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { assignModuleReinforcement, previewModuleReinforcement, type ReinforcementPreview } from '@/lib/actions/module-reinforcement';
import { conceptLabel, type ReinforcementSkip } from '@/lib/mastery/reinforcement';
import { Button } from '@/components/ui/Button';

type Stage =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'preview'; preview: ReinforcementPreview; saving: boolean }
  | { kind: 'done'; created: number; skipped: ReinforcementSkip[] }
  | { kind: 'error'; message: string };

const SKIP_TEXT: Record<ReinforcementSkip['reason'], string> = {
  active_plan: 'ya tiene un plan activo',
  no_concepts: 'no se identificaron conceptos',
};

function SkippedList({ skipped }: { skipped: ReinforcementSkip[] }) {
  if (skipped.length === 0) return null;
  return (
    <div className="text-xs text-fg-muted">
      <p className="font-semibold">No se les asigna:</p>
      <ul className="list-disc pl-5">
        {skipped.map((s) => (
          <li key={s.studentId}>
            {s.name} · {SKIP_TEXT[s.reason]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReinforcementAction({ classroomId, moduleId, moduleTitle }: { classroomId: string; moduleId: string; moduleTitle: string }) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  async function open() {
    setStage({ kind: 'loading' });
    const r = await previewModuleReinforcement(classroomId, moduleId);
    setStage(r.ok ? { kind: 'preview', preview: r.preview, saving: false } : { kind: 'error', message: r.error });
  }

  async function confirm(preview: ReinforcementPreview) {
    setStage({ kind: 'preview', preview, saving: true });
    const r = await assignModuleReinforcement(classroomId, moduleId);
    setStage(r.ok ? { kind: 'done', created: r.created, skipped: r.skipped } : { kind: 'error', message: r.error });
  }

  return (
    <div className="mt-2" aria-live="polite">
      {stage.kind === 'idle' && (
        <Button size="sm" variant="secondary" onClick={open}>
          <ClipboardList aria-hidden="true" className="w-4 h-4" /> Asignar refuerzo
          <span className="sr-only">: {moduleTitle}</span>
        </Button>
      )}

      {stage.kind === 'loading' && (
        <p role="status" className="inline-flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Preparando el refuerzo…
        </p>
      )}

      {stage.kind === 'preview' && (
        <div role="group" aria-label={`Confirmar refuerzo de ${moduleTitle}`} className="rounded-xl border border-line-strong bg-surface-2 p-4 space-y-3">
          {stage.preview.assignments.length === 0 ? (
            <p className="text-sm text-fg">No hay a quién asignar ahora: nadie está por repasar sin un plan activo.</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-fg">
                Se creará un plan de refuerzo para {stage.preview.assignments.length} {stage.preview.assignments.length === 1 ? 'estudiante' : 'estudiantes'}:
              </p>
              <ul className="space-y-1 text-sm text-fg">
                {stage.preview.assignments.map((a) => (
                  <li key={a.studentId}>
                    <span className="font-medium">{a.name}</span> <span className="text-fg-muted">· {a.concepts.map(conceptLabel).join(', ')}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-muted">
                Cada plan son 5 rondas cortas sobre esos conceptos y aparece en el inicio del estudiante. No se puede cancelar desde esta pantalla.
              </p>
            </>
          )}
          <SkippedList skipped={stage.preview.skipped} />
          <div className="flex flex-wrap gap-2">
            {stage.preview.assignments.length > 0 && (
              <Button size="sm" loading={stage.saving} onClick={() => confirm(stage.preview)}>
                Confirmar y asignar
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={stage.saving} onClick={() => setStage({ kind: 'idle' })}>
              {stage.preview.assignments.length > 0 ? 'Cancelar' : 'Cerrar'}
            </Button>
          </div>
        </div>
      )}

      {stage.kind === 'done' && (
        <div role="status" className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm text-fg space-y-2">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 aria-hidden="true" className="w-4 h-4 text-success" />
            {stage.created === 0
              ? 'No se creó ningún plan: no había a quién asignar.'
              : `Refuerzo asignado a ${stage.created} ${stage.created === 1 ? 'estudiante' : 'estudiantes'}.`}
          </p>
          <SkippedList skipped={stage.skipped} />
        </div>
      )}

      {stage.kind === 'error' && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-fg space-y-2">
          <p>{stage.message}</p>
          <Button size="sm" variant="secondary" onClick={() => setStage({ kind: 'idle' })}>
            Volver
          </Button>
        </div>
      )}
    </div>
  );
}
