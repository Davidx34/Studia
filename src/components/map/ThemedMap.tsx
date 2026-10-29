'use client';

// Plantillas del mapa de aprendizaje con tema: camino que serpentea, metro y tablero. Cada una recibe los mismos nodos que el mapa de islas y los acomoda a su
// manera; los colores, tipografias y formas salen de las variables --f-* del tema (mapThemes.css y src/lib/map/mapThemes.ts). Ninguna cambia el contenido ni el estado.
//
// Reglas (las revisa maps.test.ts): cada modulo es un boton con su estado dicho con texto (aria-label y etiqueta visible), los bloqueados siguen siendo enfocables
// (aria-disabled) y al activarlos Toñito explica por que, ningun modulo se pierde aunque su tema no tenga metadatos, los iconos son decorativos (lucide) y el movimiento
// respeta prefers-reduced-motion.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, Play, Star } from 'lucide-react';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { NodeDetailModal } from '@/app/(student)/map/LearningMap';
import { fontClass } from '@/components/study/fichas/fichaFonts';
import { columnsFor, groupByCategory, serpentine } from '@/lib/map/mapLayouts';
import { getMapTheme } from '@/lib/map/mapThemes';
import type { MapLayout } from '@/lib/map/mapTemplates';
import { NODE_STATUS_TEXT, metaFor, type CategoryMeta, type MapNode } from '@/lib/map/types';
import '@/components/study/fichas/fichaThemes.css';
import './mapThemes.css';

type Meta = Record<string, CategoryMeta>;

function Glyph({ node, n }: { node: MapNode; n: number }) {
  if (node.status === 'completed') return <Check aria-hidden="true" />;
  if (node.status === 'locked') return <Lock aria-hidden="true" />;
  if (node.status === 'in_progress' || node.status === 'current') return <Play aria-hidden="true" />;
  return n > 0 ? <span aria-hidden="true">{n}</span> : null; // la leyenda muestra el circulo sin numero
}

function Stars({ n }: { n: number }) {
  return (
    <span className="fm-stars" aria-label={`Dificultad ${n} de 3`} role="img">
      {[0, 1, 2].map((i) => (
        <Star key={i} aria-hidden="true" className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

const labelOf = (node: MapNode) => `${node.title}, ${NODE_STATUS_TEXT[node.status]}`;

interface LayoutProps {
  nodes: MapNode[];
  categoryMeta: Meta;
  onNode: (n: MapNode) => void;
}

// ── Camino que serpentea ──
function Camino({ nodes, onNode }: LayoutProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setCols(columnsFor(el.clientWidth));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // El camino recorre un tema completo antes de pasar al siguiente (y dentro de cada uno, respetando los prerrequisitos).
  const layout = useMemo(() => serpentine(groupByCategory(nodes).flatMap((g) => g.nodes), cols), [nodes, cols]);

  const bulge = 9;
  const d = (s: (typeof layout.segments)[number]) => {
    const { from, to } = s;
    if (s.kind === 'row') return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    const b = s.side === 'right' ? bulge : -bulge;
    return `M ${from.x} ${from.y} C ${from.x + b} ${from.y}, ${from.x + b} ${to.y}, ${to.x} ${to.y}`;
  };

  return (
    <div ref={ref} className="fm-camino" style={{ height: layout.height }}>
      <svg aria-hidden="true" className="fm-road" viewBox={`0 0 100 ${layout.height}`} preserveAspectRatio="none">
        {layout.segments.map((s) => (
          <path key={`${s.from.node.id}-${s.to.node.id}`} d={d(s)} className={s.from.node.status === 'completed' ? 'fm-road-done' : 'fm-road-todo'} />
        ))}
      </svg>
      {layout.placed.map((p, i) => (
        <div key={p.node.id} className="fm-pos" style={{ left: `${p.x}%`, top: p.y }}>
          <button type="button" className={`fm-btn fm-s-${p.node.status}`} aria-label={labelOf(p.node)} aria-disabled={p.node.status === 'locked' || undefined} onClick={() => onNode(p.node)}>
            <span className="fm-dot"><Glyph node={p.node} n={i + 1} /></span>
            <span aria-hidden="true" className="fm-label">{p.node.title}</span>
            <span aria-hidden="true" className="fm-status">{NODE_STATUS_TEXT[p.node.status]}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Metro: una linea por tema ──
function Metro({ nodes, categoryMeta, onNode }: LayoutProps) {
  const groups = useMemo(() => groupByCategory(nodes), [nodes]);
  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
  return (
    <div className="fm-metro">
      {groups.map((g, gi) => {
        const t = (gi % 3) + 1; // colores de linea: los tres primeros del tema
        const meta = metaFor(categoryMeta, g.category);
        return (
          <section key={g.category} className="fk-card fm-line" style={{ ['--lc' as string]: `var(--f-t${t}-bg)`, ['--lfg' as string]: `var(--f-t${t}-fg)` }}>
            <header className={`fm-line-head fk-tile-${t}`}>
              <h3>{meta.label}</h3>
              <p className="fk-label">{g.completed}/{g.total}</p>
            </header>
            <ol className="fm-stations">
              {g.nodes.map((n, i) => {
                const req = n.prerequisites.map((id) => titleOf.get(id)).filter(Boolean).slice(0, 2);
                return (
                  <li key={n.id} className={`fm-station fm-s-${n.status}`}>
                    <button type="button" className="fm-btn" aria-label={labelOf(n)} aria-disabled={n.status === 'locked' || undefined} onClick={() => onNode(n)}>
                      <span className="fm-dot"><Glyph node={n} n={i + 1} /></span>
                      <span aria-hidden="true" className="fm-station-title">{n.title}</span>
                      <span aria-hidden="true" className="fm-status" style={{ display: 'block' }}>{NODE_STATUS_TEXT[n.status]}</span>
                      {req.length > 0 && <span aria-hidden="true" className="fm-req" style={{ display: 'block' }}>Requiere: {req.join(', ')}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

// ── Tablero ──
function Tablero({ nodes, categoryMeta, onNode }: LayoutProps) {
  const groups = useMemo(() => groupByCategory(nodes), [nodes]);
  return (
    <div className="fm-board">
      {groups.map((g) => {
        const meta = metaFor(categoryMeta, g.category);
        return (
          <section key={g.category}>
            <div className="fm-group-head">
              <h3 className="fk-title" style={{ fontSize: '1.15rem' }}>{meta.label}</h3>
              <p className="fk-label">{g.completed}/{g.total} completados</p>
            </div>
            <ul className="fm-cards">
              {g.nodes.map((n, i) => (
                <li key={n.id}>
                  <button type="button" className={`fm-btn fm-card-btn fm-s-${n.status}`} aria-label={labelOf(n)} aria-disabled={n.status === 'locked' || undefined} onClick={() => onNode(n)}>
                    <span className="fm-card-top">
                      <span className="fm-dot"><Glyph node={n} n={i + 1} /></span>
                      <span aria-hidden="true" className="fm-card-title">{n.title}</span>
                    </span>
                    <span aria-hidden="true" className="fm-meta">
                      <span className="fm-status">{NODE_STATUS_TEXT[n.status]}</span>
                      <Stars n={n.difficulty} />
                    </span>
                    <span aria-hidden="true" className="fm-meta">
                      <span>{n.score !== null ? `Mejor puntaje: ${n.score}` : 'Sin puntaje'}</span>
                      <span>{n.completionPct}%</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const LAYOUTS: Partial<Record<MapLayout, (p: LayoutProps) => JSX.Element>> = { camino: Camino, metro: Metro, tablero: Tablero };

const LEGEND: { status: MapNode['status']; text: string }[] = [
  { status: 'completed', text: 'Completado' },
  { status: 'in_progress', text: 'En curso' },
  { status: 'available', text: 'Disponible' },
  { status: 'locked', text: 'Bloqueado' },
];

export function ThemedMap({
  nodes,
  categoryMeta,
  layout,
  themeId,
  title = 'Mapa de Aprendizaje',
  headingLevel = 'h2',
  stats,
  interactive = true,
  compact = false,
}: {
  nodes: MapNode[];
  categoryMeta: Meta;
  layout: MapLayout;
  themeId: string;
  title?: string;
  headingLevel?: 'h1' | 'h2';
  stats: { total: number; completed: number };
  // Falso en las miniaturas del selector del profesor: sin saludo de Toñito.
  interactive?: boolean;
  // Solo el mapa, sin encabezado ni leyenda: para las miniaturas.
  compact?: boolean;
}) {
  const theme = getMapTheme(themeId);
  const Layout = LAYOUTS[layout];
  const Heading = headingLevel;
  const [selected, setSelected] = useState<MapNode | null>(null);
  const showMessage = useTonitoStore((s) => s.showMessage);
  const setMood = useTonitoStore((s) => s.setMood);

  useEffect(() => {
    if (!interactive) return;
    const timer = setTimeout(() => {
      const next = nodes.find((n) => n.status === 'in_progress' || n.status === 'available');
      showMessage(next ? `¡Tu siguiente parada es "${next.title}"! 🗺️` : '¡Explora todo el mapa! 🌟', next ? 5000 : 4000);
    }, 600);
    return () => clearTimeout(timer);
  }, [nodes, showMessage, interactive]);

  if (!theme || !Layout) return null;

  const onNode = (n: MapNode) => {
    if (n.status === 'locked') {
      setMood('thinking');
      showMessage('¡Aún no puedes! Termina los anteriores 🔒', 3000);
      return;
    }
    setSelected(n);
  };

  const pct = stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * 100);

  return (
    <div className={`fk fm ${fontClass(theme.font)} fm-path-${theme.vars['--f-path-style']}`} style={theme.vars as React.CSSProperties} data-map-theme={themeId} data-map-layout={layout}>
      {!compact && (
        <div className="fm-head">
          <div>
            <Heading className="fm-title">{title}</Heading>
            <p className="fm-sub">{stats.completed} de {stats.total} módulos completados</p>
            <div className="fm-progress" role="progressbar" aria-label="Módulos completados" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
          <ul className="fm-legend" aria-label="Leyenda del mapa">
            {LEGEND.map((l) => (
              <li key={l.status} className={`fm-s-${l.status}`}>
                <span aria-hidden="true" className="fm-dot">
                  <Glyph node={{ status: l.status } as MapNode} n={0} />
                </span>
                {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Layout nodes={nodes} categoryMeta={categoryMeta} onNode={onNode} />
      {selected && <NodeDetailModal node={selected} meta={metaFor(categoryMeta, selected.category)} onClose={() => setSelected(null)} />}
    </div>
  );
}
