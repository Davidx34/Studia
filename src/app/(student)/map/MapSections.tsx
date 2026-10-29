'use client';

// El mapa de aprendizaje del estudiante: una SECCION por clase, cada una pintada con la plantilla que eligio el profesor de esa clase (src/lib/map/mapTemplates.ts).
// Los modulos sin clase van en "Modulos generales" con el mapa de islas de siempre. Con varias secciones se elige la clase con pestañas; con una sola, no hay pestañas.

import { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { LearningMap } from './LearningMap';
import { ThemedMap } from '@/components/map/ThemedMap';
import { defaultSectionId, type MapSection } from '@/lib/map/mapSections';
import { getMapTemplate } from '@/lib/map/mapTemplates';
import type { CategoryMeta } from '@/lib/map/types';

export function MapView({ section, categoryMeta, title, headingLevel }: { section: MapSection; categoryMeta: Record<string, CategoryMeta>; title: string; headingLevel: 'h1' | 'h2' }) {
  const info = getMapTemplate(section.template);
  const stats = { total: section.total, completed: section.completed };
  if (info.layout === 'islas' || !info.theme) {
    return <LearningMap nodes={section.nodes} categoryMeta={categoryMeta} stats={stats} title={title} headingLevel={headingLevel} />;
  }
  return <ThemedMap nodes={section.nodes} categoryMeta={categoryMeta} layout={info.layout} themeId={info.theme} title={title} headingLevel={headingLevel} stats={stats} />;
}

export function MapSections({ sections, categoryMeta }: { sections: MapSection[]; categoryMeta: Record<string, CategoryMeta> }) {
  const [activeId, setActiveId] = useState<string | null>(() => defaultSectionId(sections));
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  if (sections.length === 0) {
    return (
      <div className="theme-scope space-y-2">
        <h1 className="text-2xl font-bold text-fg">Mapa de Aprendizaje</h1>
        <p className="text-fg-muted">Todavía no hay módulos en tus clases. Cuando tu profesor los prepare, aparecerán aquí.</p>
      </div>
    );
  }

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  // Una sola seccion: sin pestañas, como el mapa de siempre.
  if (sections.length === 1) {
    return (
      <div className="theme-scope">
        <MapView section={active} categoryMeta={categoryMeta} title={active.general ? 'Mapa de Aprendizaje' : `Mapa de Aprendizaje · ${active.title}`} headingLevel="h1" />
      </div>
    );
  }

  const total = sections.reduce((n, s) => n + s.total, 0);
  const done = sections.reduce((n, s) => n + s.completed, 0);

  const move = (from: number, delta: number) => {
    const next = (from + delta + sections.length) % sections.length;
    setActiveId(sections[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <div className="theme-scope space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <Sparkles aria-hidden="true" className="h-6 w-6 text-accent-text" /> Mapa de Aprendizaje
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {done} de {total} módulos completados en {sections.length} {sections.length === 1 ? 'clase' : 'clases'}
        </p>
      </div>

      <div role="tablist" aria-label="Clases" className="flex gap-2 overflow-x-auto pb-1">
        {sections.map((s, i) => {
          const on = s.id === active.id;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-map-${s.id}`}
              aria-selected={on}
              aria-controls="panel-map"
              tabIndex={on ? 0 : -1}
              onClick={() => setActiveId(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
                on ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-fg-muted hover:text-fg'
              }`}
            >
              {s.title}
              <span className={`text-xs ${on ? 'opacity-90' : 'text-fg-muted'}`}>
                {s.completed}/{s.total}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="panel-map" aria-labelledby={`tab-map-${active.id}`}>
        <MapView key={active.id} section={active} categoryMeta={categoryMeta} title={active.title} headingLevel="h2" />
      </div>
    </div>
  );
}
