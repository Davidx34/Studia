'use client';

// Selector generico de plantilla para el panel del profesor: galeria agrupada por categoria con una miniatura REAL de cada opcion, vista previa completa y boton "Guardar".
// Elegir no cambia nada hasta pulsar Guardar: la plantilla es de toda la clase y se guarda en una columna de classrooms. Guardarla no llama a la IA.
// (Lo usan las infografias; los selectores de fichas y del mapa tienen su propia version.)

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export interface TemplateOption {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  category: string;
}

export interface TemplateCategory {
  id: string;
  label: string;
  hint: string;
}

// La miniatura es solo para MIRAR: sin foco, sin clics y oculta a los lectores de pantalla (la descripcion de la plantilla ya la explica).
function Miniature({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) (ref.current as any).inert = true;
  }, []);
  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none relative h-44 overflow-hidden rounded-lg border border-line bg-bg">
      <div className="w-[160%] origin-top-left scale-[0.62] p-3">{children}</div>
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bg to-transparent" />
    </div>
  );
}

export function TemplatePicker({
  classroomId,
  column,
  radioName,
  initialId,
  normalize,
  templates,
  categories,
  title,
  icon,
  intro,
  renderMiniature,
  renderFull,
  previewTitle,
  previewNote,
  saveLabel,
  savedMessage,
}: {
  classroomId: string;
  // Columna de classrooms donde se guarda el id (por ejemplo 'infographic_template').
  column: string;
  radioName: string;
  initialId: string | null;
  normalize: (v: unknown) => string;
  templates: readonly TemplateOption[];
  categories: readonly TemplateCategory[];
  title: string;
  icon: ReactNode;
  intro: ReactNode;
  renderMiniature: (id: string) => ReactNode;
  renderFull: (id: string) => ReactNode;
  previewTitle: (name: string) => string;
  previewNote: string;
  saveLabel: string;
  savedMessage: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const saved = normalize(initialId);
  const [savedId, setSavedId] = useState(saved);
  const [selected, setSelected] = useState(saved);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const dirty = selected !== savedId;
  const current = templates.find((t) => t.id === selected) ?? templates[0];

  const save = async () => {
    setState('saving');
    // Las columnas nuevas aun no estan en los tipos generados de la base.
    const { error } = await (supabase as any).from('classrooms').update({ [column]: selected }).eq('id', classroomId);
    if (error) {
      setState('error');
      return;
    }
    setSavedId(selected);
    setState('saved');
  };

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h3 className="flex items-center gap-2 text-base font-bold text-fg">
          {icon} {title}
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">{intro}</p>
      </div>

      <fieldset className="space-y-6">
        <legend className="sr-only">{title}</legend>
        {categories.map((cat) => (
          <div key={cat.id}>
            <div className="mb-2">
              <h4 className="text-sm font-bold text-fg">{cat.label}</h4>
              <p className="text-xs text-fg-muted">{cat.hint}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {templates
                .filter((t) => t.category === cat.id)
                .map((t) => {
                  const on = t.id === selected;
                  return (
                    <label key={t.id} className="relative block cursor-pointer">
                      <input
                        type="radio"
                        name={radioName}
                        value={t.id}
                        checked={on}
                        onChange={() => {
                          setSelected(t.id);
                          setState('idle');
                        }}
                        className="peer sr-only"
                      />
                      <div
                        className={`h-full space-y-2 rounded-xl border-2 p-3 transition motion-reduce:transition-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg ${
                          on ? 'border-primary bg-primary/5' : 'border-line bg-surface hover:border-line-strong'
                        }`}
                      >
                        <Miniature>{renderMiniature(t.id)}</Miniature>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-fg">{t.name}</span>
                          {on && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text">
                              <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Elegida
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-fg-muted">{t.description}</p>
                        <p className="text-xs text-fg-muted">
                          <span className="font-semibold text-fg">Ideal para: </span>
                          {t.bestFor}
                        </p>
                      </div>
                    </label>
                  );
                })}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty || state === 'saving'} loading={state === 'saving'}>
          {saveLabel}
        </Button>
        <p role="status" aria-live="polite" className={`text-sm ${state === 'error' ? 'text-danger' : 'text-fg-muted'}`}>
          {state === 'saving' && (
            <span className="inline-flex items-center gap-1">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Guardando…
            </span>
          )}
          {state === 'saved' && savedMessage}
          {state === 'error' && 'No se pudo guardar la plantilla. Revisa tu conexión e inténtalo de nuevo.'}
          {state === 'idle' && dirty && 'Tienes un cambio sin guardar.'}
          {state === 'idle' && !dirty && `Plantilla actual: ${current.name}.`}
        </p>
      </div>

      <details className="rounded-xl border border-line bg-surface-2">
        <summary className="min-h-[44px] cursor-pointer list-none px-4 py-3 text-sm font-semibold text-fg">{previewTitle(current.name)}</summary>
        <div className="border-t border-line p-4">
          <p className="mb-3 text-xs text-fg-muted">{previewNote}</p>
          {renderFull(selected)}
        </div>
      </details>
    </Card>
  );
}
