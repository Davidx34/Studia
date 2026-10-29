'use client';

// Selector de la plantilla de las fichas de lectura, para el panel del profesor. Cada opcion muestra la plantilla REAL (los mismos componentes que ve el
// estudiante) con las fichas del propio profesor, o con fichas de ejemplo si todavia no genero ninguna. Elegir no cambia nada hasta pulsar "Guardar":
// la plantilla es de toda la clase. Guardarla no llama a la IA ni toca las fichas.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Palette } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FICHA_TEMPLATES, SAMPLE_FICHAS, normalizeFichaTemplate, type FichaData, type FichaTemplateId } from '@/lib/study/fichaTemplates';
import { FichaList } from './FichaViews';

// La miniatura es solo para MIRAR: sin foco, sin clics y oculta a los lectores de pantalla (la descripcion de la plantilla ya la explica).
function Miniature({ fichas, template }: { fichas: FichaData[]; template: FichaTemplateId }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) (ref.current as any).inert = true;
  }, []);
  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none relative h-44 overflow-hidden rounded-lg border border-line bg-bg">
      <div className="w-[160%] origin-top-left scale-[0.62] p-3">
        <FichaList fichas={fichas.slice(0, 1)} template={template} />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bg to-transparent" />
    </div>
  );
}

export function FichaTemplatePicker({
  classroomId,
  initialTemplate,
  previewFichas,
}: {
  classroomId: string;
  initialTemplate: string | null;
  // Fichas reales de la clase para la vista previa (hasta 2). Vacio = se usan las de ejemplo.
  previewFichas: FichaData[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const saved = normalizeFichaTemplate(initialTemplate);
  const [savedId, setSavedId] = useState<FichaTemplateId>(saved);
  const [selected, setSelected] = useState<FichaTemplateId>(saved);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const real = previewFichas.length > 0;
  const fichas = real ? previewFichas : SAMPLE_FICHAS;
  const dirty = selected !== savedId;
  const current = FICHA_TEMPLATES.find((t) => t.id === selected)!;

  const save = async () => {
    setState('saving');
    // La columna aun no esta en los tipos generados de la base.
    const { error } = await (supabase as any).from('classrooms').update({ ficha_template: selected }).eq('id', classroomId);
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
          <Palette aria-hidden="true" className="h-5 w-5 text-primary-text" /> Plantilla de las fichas de lectura
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Elige cómo verán tus estudiantes las fichas. Cambiar de plantilla es instantáneo: <strong className="text-fg">no vuelve a usar la IA</strong> ni modifica el
          contenido de las fichas.
        </p>
      </div>

      <fieldset>
        <legend className="sr-only">Plantilla de las fichas</legend>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FICHA_TEMPLATES.map((t) => {
            const on = t.id === selected;
            return (
              <label key={t.id} className="relative block cursor-pointer">
                <input
                  type="radio"
                  name="ficha-template"
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
                  <Miniature fichas={fichas} template={t.id} />
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
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty || state === 'saving'} loading={state === 'saving'}>
          Guardar plantilla
        </Button>
        <p role="status" aria-live="polite" className={`text-sm ${state === 'error' ? 'text-danger' : 'text-fg-muted'}`}>
          {state === 'saving' && (
            <span className="inline-flex items-center gap-1">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Guardando…
            </span>
          )}
          {state === 'saved' && 'Listo: tus estudiantes ya ven las fichas con esta plantilla.'}
          {state === 'error' && 'No se pudo guardar la plantilla. Revisa tu conexión e inténtalo de nuevo.'}
          {state === 'idle' && dirty && 'Tienes un cambio sin guardar.'}
          {state === 'idle' && !dirty && `Plantilla actual: ${current.name}.`}
        </p>
      </div>

      <details className="rounded-xl border border-line bg-surface-2">
        <summary className="min-h-[44px] cursor-pointer list-none px-4 py-3 text-sm font-semibold text-fg">
          Ver la plantilla “{current.name}” completa {real ? 'con tus fichas' : '(con fichas de ejemplo)'}
        </summary>
        <div className="border-t border-line p-4">
          {!real && <p className="mb-3 text-xs text-fg-muted">Todavía no generaste fichas: esto es un ejemplo. Cuando las generes, aquí verás las tuyas.</p>}
          <FichaList fichas={fichas} template={selected} />
        </div>
      </details>
    </Card>
  );
}
