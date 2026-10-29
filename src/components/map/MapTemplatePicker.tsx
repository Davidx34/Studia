'use client';

// Selector de la plantilla del MAPA de aprendizaje, para el panel del profesor. Cada opcion muestra la plantilla REAL (los mismos componentes que ve el estudiante) con
// los modulos de la clase (con un avance simulado) o con un mapa de ejemplo si todavia no hay modulos. Elegir no cambia nada hasta pulsar "Guardar": la plantilla es
// de toda la clase. Guardarla no llama a la IA ni toca los modulos.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Map as MapIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LearningMap } from '@/app/(student)/map/LearningMap';
import { ThemedMap } from './ThemedMap';
import { CATEGORY_META } from '@/lib/map/mapSamples';
import { MAP_CATEGORY_HINT, MAP_CATEGORY_LABEL, MAP_TEMPLATES, getMapTemplate, normalizeMapTemplate, type MapCategory, type MapTemplateId } from '@/lib/map/mapTemplates';
import type { MapNode } from '@/lib/map/types';

const CATEGORIES: MapCategory[] = ['funcional', 'infantil', 'area', 'estetica'];

// El mapa con la plantilla indicada, tal como lo ve el estudiante (sin saludo de Toñito).
function MapPreview({ template, nodes, compact = false }: { template: MapTemplateId; nodes: MapNode[]; compact?: boolean }) {
  const info = getMapTemplate(template);
  const stats = { total: nodes.length, completed: nodes.filter((n) => n.status === 'completed').length };
  if (info.layout === 'islas' || !info.theme) {
    return <LearningMap nodes={nodes} categoryMeta={CATEGORY_META} stats={stats} title="Mapa de Aprendizaje" headingLevel="h2" quiet />;
  }
  return <ThemedMap nodes={nodes} categoryMeta={CATEGORY_META} layout={info.layout} themeId={info.theme} title="Mapa de Aprendizaje" headingLevel="h2" stats={stats} interactive={false} compact={compact} />;
}

// La miniatura es solo para MIRAR: sin foco, sin clics y oculta a los lectores de pantalla (la descripcion de la plantilla ya la explica).
function Miniature({ template, nodes }: { template: MapTemplateId; nodes: MapNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) (ref.current as any).inert = true;
  }, []);
  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none relative h-44 overflow-hidden rounded-lg border border-line bg-bg">
      <div className="w-[160%] origin-top-left scale-[0.62]">
        <MapPreview template={template} nodes={nodes.slice(0, 6)} compact />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bg to-transparent" />
    </div>
  );
}

export function MapTemplatePicker({
  classroomId,
  initialTemplate,
  nodes,
  real,
}: {
  classroomId: string;
  initialTemplate: string | null;
  // Modulos para la vista previa (reales con avance simulado, o de ejemplo) y si son reales.
  nodes: MapNode[];
  real: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const saved = normalizeMapTemplate(initialTemplate);
  const [savedId, setSavedId] = useState<MapTemplateId>(saved);
  const [selected, setSelected] = useState<MapTemplateId>(saved);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const dirty = selected !== savedId;
  const current = getMapTemplate(selected);

  const save = async () => {
    setState('saving');
    // La columna aun no esta en los tipos generados de la base.
    const { error } = await (supabase as any).from('classrooms').update({ map_template: selected }).eq('id', classroomId);
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
          <MapIcon aria-hidden="true" className="h-5 w-5 text-primary-text" /> Plantilla del mapa de aprendizaje
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Tus estudiantes ven un mapa por clase, y este es el estilo del de la tuya. Cambiarlo es instantáneo: <strong className="text-fg">no vuelve a usar la IA</strong>{' '}
          ni mueve ni cambia tus módulos.
        </p>
      </div>

      <fieldset className="space-y-6">
        <legend className="sr-only">Plantilla del mapa</legend>
        {CATEGORIES.map((cat) => (
          <div key={cat}>
            <div className="mb-2">
              <h4 className="text-sm font-bold text-fg">{MAP_CATEGORY_LABEL[cat]}</h4>
              <p className="text-xs text-fg-muted">{MAP_CATEGORY_HINT[cat]}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {MAP_TEMPLATES.filter((t) => t.category === cat).map((t) => {
                const on = t.id === selected;
                return (
                  <label key={t.id} className="relative block cursor-pointer">
                    <input
                      type="radio"
                      name="map-template"
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
                      <Miniature template={t.id} nodes={nodes} />
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
          Guardar plantilla del mapa
        </Button>
        <p role="status" aria-live="polite" className={`text-sm ${state === 'error' ? 'text-danger' : 'text-fg-muted'}`}>
          {state === 'saving' && (
            <span className="inline-flex items-center gap-1">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Guardando…
            </span>
          )}
          {state === 'saved' && 'Listo: tus estudiantes ya ven el mapa de tu clase con esta plantilla.'}
          {state === 'error' && 'No se pudo guardar la plantilla. Revisa tu conexión e inténtalo de nuevo.'}
          {state === 'idle' && dirty && 'Tienes un cambio sin guardar.'}
          {state === 'idle' && !dirty && `Plantilla actual: ${current.name}.`}
        </p>
      </div>

      <details className="rounded-xl border border-line bg-surface-2">
        <summary className="min-h-[44px] cursor-pointer list-none px-4 py-3 text-sm font-semibold text-fg">
          Ver el mapa “{current.name}” completo {real ? 'con tus módulos' : '(con módulos de ejemplo)'}
        </summary>
        <div className="border-t border-line p-4">
          <p className="mb-3 text-xs text-fg-muted">
            {real
              ? 'Estos son tus módulos con un avance simulado (el primero completado, el segundo en curso) para que veas todos los estados.'
              : 'Todavía no tienes módulos (o tienes muy pocos): esto es un ejemplo. Cuando generes tu mapa, aquí verás el tuyo.'}
          </p>
          <MapPreview template={selected} nodes={nodes} />
        </div>
      </details>
    </Card>
  );
}
