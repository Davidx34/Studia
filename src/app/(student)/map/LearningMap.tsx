'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { Lock, Star, Sparkles, ChevronDown, X } from 'lucide-react';
import { NODE_STATUS_TEXT, type CategoryMeta, type MapNode } from '@/lib/map/types';

type Meta = CategoryMeta;

interface Props {
  nodes: MapNode[];
  categoryMeta: Record<string, Meta>;
  stats: { total: number; completed: number };
  // Titulo y nivel del encabezado: por defecto el del mapa unico de siempre (h1). Con una seccion por clase, el titulo es el de la clase y el nivel es h2.
  title?: string;
  headingLevel?: 'h1' | 'h2';
  // Sin el saludo de Toñito: para las miniaturas del selector del profesor.
  quiet?: boolean;
}

const VIEWBOX_W = 1000;
const VIEWBOX_H = 1600;

// El texto del estado de cada nodo (no solo color) vive en lib/map/types.ts, compartido con las demas plantillas del mapa.
export { NODE_STATUS_TEXT };

export function LearningMap({ nodes, categoryMeta, stats, title = 'Mapa de Aprendizaje', headingLevel = 'h1', quiet = false }: Props) {
  const Heading = headingLevel;
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null);
  const showMessage = useTonitoStore((s) => s.showMessage);
  const setMood = useTonitoStore((s) => s.setMood);
  const containerRef = useRef<HTMLDivElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Saludo de Toñito al entrar al mapa
  useEffect(() => {
    if (quiet) return;
    const timer = setTimeout(() => {
      const next = nodes.find((n) => n.status === 'in_progress' || n.status === 'available');
      if (next) {
        showMessage(`¡Tu siguiente parada es "${next.title}"! 🗺️`, 5000);
      } else {
        showMessage('¡Explora todas las islas del mapa! 🌟', 4000);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [nodes, showMessage, quiet]);

  // Parallax sutil con el mouse (se desactiva con "reducir movimiento")
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || reduceMotion) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width - 0.5;
    const cy = (e.clientY - rect.top) / rect.height - 0.5;
    setParallax({ x: cx * 12, y: cy * 12 });
  };

  // Caminos: para cada nodo con prerequisitos, dibujar línea curva al primer prereq
  const paths = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    return nodes
      .filter((n) => n.prerequisites.length > 0)
      .map((n) => {
        const prereq = nodeMap.get(n.prerequisites[0]);
        if (!prereq) return null;
        const isUnlocked = prereq.status === 'completed';
        // Curva Bezier suave
        const dx = n.x - prereq.x;
        const cp1x = prereq.x + dx * 0.5;
        const cp1y = prereq.y;
        const cp2x = prereq.x + dx * 0.5;
        const cp2y = n.y;
        return {
          id: `${prereq.id}-${n.id}`,
          d: `M ${prereq.x} ${prereq.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${n.x} ${n.y}`,
          unlocked: isUnlocked,
        };
      })
      .filter(Boolean) as { id: string; d: string; unlocked: boolean }[];
  }, [nodes]);

  // Agrupar nodos por categoría para los headers de isla
  const islandHeaders = useMemo(() => {
    const groups = new Map<string, { minY: number; maxY: number; count: number; completed: number }>();
    nodes.forEach((n) => {
      const g = groups.get(n.category) || { minY: Infinity, maxY: -Infinity, count: 0, completed: 0 };
      g.minY = Math.min(g.minY, n.y);
      g.maxY = Math.max(g.maxY, n.y);
      g.count++;
      if (n.status === 'completed') g.completed++;
      groups.set(n.category, g);
    });
    return Array.from(groups.entries()).map(([cat, info]) => ({
      category: cat,
      ...info,
      headerY: info.minY - 90,
    }));
  }, [nodes]);

  return (
    <div className="theme-scope space-y-4">
      {!quiet && (
        <>
      {/* Header del mapa */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Heading className="text-2xl font-bold text-fg flex items-center gap-2">
            <Sparkles aria-hidden="true" className="w-6 h-6 text-accent-text" /> {title}
          </Heading>
          <p className="text-sm text-fg-muted mt-1">
            {stats.completed} de {stats.total} módulos completados
          </p>
        </div>
        <ul className="flex items-center gap-3 flex-wrap text-xs text-fg-muted" aria-label="Leyenda del mapa">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-3 h-3 rounded-full bg-success" /> Completado
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-3 h-3 rounded-full bg-accent animate-pulse motion-reduce:animate-none" /> Actual
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-3 h-3 rounded-full border-2 border-primary bg-surface" /> Disponible
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-3 h-3 rounded-full bg-line-strong" /> Bloqueado
          </li>
        </ul>
      </div>

      {/* Hint de scroll */}
      <div className="flex items-center justify-center gap-2 text-xs text-fg-muted">
        <ChevronDown aria-hidden="true" className="w-4 h-4 animate-bounce motion-reduce:animate-none" />
        Desplázate para explorar todas las islas
      </div>

        </>
      )}

      {/* Container del mapa */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setParallax({ x: 0, y: 0 })}
        className="relative w-full bg-surface border border-line rounded-3xl overflow-hidden"
        style={{ aspectRatio: `${VIEWBOX_W}/${VIEWBOX_H}` }}
      >
        {/* SVG de fondo: caminos + decoración */}
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="xMidYMid meet"
          style={{ transform: `translate(${parallax.x * -0.5}px, ${parallax.y * -0.5}px)`, transition: reduceMotion ? 'none' : 'transform 0.3s ease-out' }}
        >
          <defs>
            <pattern id="dotPattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="1.5" fill="rgb(var(--c-line))" />
            </pattern>
          </defs>

          {/* Fondo punteado */}
          <rect width={VIEWBOX_W} height={VIEWBOX_H} fill="url(#dotPattern)" />

          {/* "Islas" — bandas suaves de fondo por categoría */}
          {islandHeaders.map((island) => {
            const meta = categoryMeta[island.category];
            if (!meta) return null;
            return (
              <ellipse
                key={`island-${island.category}`}
                cx={VIEWBOX_W / 2}
                cy={(island.minY + island.maxY) / 2}
                rx={VIEWBOX_W * 0.45}
                ry={(island.maxY - island.minY) / 2 + 80}
                fill={meta.color}
                opacity="0.08"
              />
            );
          })}

          {/* Caminos curvos entre nodos */}
          {paths.map((p) => (
            <path
              key={p.id}
              d={p.d}
              fill="none"
              stroke={p.unlocked ? 'rgb(var(--c-accent))' : 'rgb(var(--c-line-strong))'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={p.unlocked ? '0' : '12 8'}
            />
          ))}
        </svg>

        {/* Headers de isla (HTML para mejor tipografía) */}
        {islandHeaders.map((island) => {
          const meta = categoryMeta[island.category];
          if (!meta) return null;
          const yPct = (island.headerY / VIEWBOX_H) * 100;
          return (
            <div
              key={`header-${island.category}`}
              className="absolute pointer-events-none"
              style={{ left: '50%', top: `${yPct}%`, transform: 'translate(-50%, -50%)' }}
            >
              <div
                className="bg-surface border-2 rounded-full px-5 py-2 flex items-center gap-2 shadow-lg"
                style={{ borderColor: meta.color }}
              >
                <span aria-hidden="true" className="text-2xl">{meta.emoji}</span>
                <div>
                  <div className="text-sm font-bold text-fg leading-tight">{meta.label}</div>
                  <div className="text-xs text-fg-muted leading-tight">
                    {island.completed}/{island.count} completados
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Nodos (HTML absolutos sobre el SVG) */}
        {nodes.map((node) => {
          const meta = categoryMeta[node.category];
          if (!meta) return null;
          return (
            <MapNodeButton
              key={node.id}
              node={node}
              meta={meta}
              onClick={() => {
                if (node.status === 'locked') {
                  setMood('thinking');
                  showMessage('¡Aún no puedes! Termina los anteriores 🔒', 3000);
                  return;
                }
                setSelectedNode(node);
              }}
              parallax={parallax}
              reduceMotion={reduceMotion}
            />
          );
        })}
      </div>

      {/* Modal de detalle del nodo seleccionado */}
      {selectedNode && (
        <NodeDetailModal
          node={selectedNode}
          meta={categoryMeta[selectedNode.category]}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

// ── Botón de nodo ──
function MapNodeButton({
  node,
  meta,
  onClick,
  parallax,
  reduceMotion,
}: {
  node: MapNode;
  meta: Meta;
  onClick: () => void;
  parallax: { x: number; y: number };
  reduceMotion: boolean;
}) {
  const xPct = (node.x / VIEWBOX_W) * 100;
  const yPct = (node.y / VIEWBOX_H) * 100;

  const isLocked = node.status === 'locked';
  const isCompleted = node.status === 'completed';
  const isInProgress = node.status === 'in_progress';

  // Los bloqueados siguen siendo enfocables (aria-disabled, no disabled): al activarlos Toñito explica por que.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={isLocked || undefined}
      aria-label={`${node.title}, ${NODE_STATUS_TEXT[node.status]}`}
      className={`absolute group rounded-full ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: `translate(-50%, -50%) translate(${parallax.x}px, ${parallax.y}px)`,
        transition: reduceMotion ? 'none' : 'transform 0.3s ease-out',
      }}
    >
      {/* Pulso para el "current" */}
      {isInProgress && (
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full animate-ping motion-reduce:animate-none bg-accent/40"
          style={{ transform: 'scale(1.4)' }}
        />
      )}

      {/* Círculo principal */}
      <div
        className={`relative w-20 h-20 rounded-full flex items-center justify-center font-bold text-2xl transition-all motion-reduce:transition-none border-4 shadow-lg ${
          isLocked
            ? 'opacity-70 scale-90 bg-surface-2 border-line-strong'
            : isCompleted
            ? 'border-success group-hover:scale-110 group-active:scale-95'
            : isInProgress
            ? 'border-accent bg-surface group-hover:scale-110 group-active:scale-95'
            : 'border-primary bg-surface group-hover:scale-110 group-active:scale-95'
        } ${isInProgress && !reduceMotion ? 'map-float' : ''}`}
        style={isCompleted ? { background: `linear-gradient(135deg, ${meta.gradient[0]}, ${meta.gradient[1]})` } : undefined}
      >
        {isLocked ? (
          <Lock aria-hidden="true" className="w-7 h-7 text-fg-muted" />
        ) : isCompleted ? (
          <div className="relative">
            <Star aria-hidden="true" className="w-9 h-9 text-accent fill-accent" />
            {node.score === 100 && (
              <span className="absolute -top-1 -right-3 text-[10px] font-bold bg-accent text-on-accent rounded-full px-1">100</span>
            )}
          </div>
        ) : (
          <span aria-hidden="true">{meta.emoji}</span>
        )}
      </div>

      {/* Etiqueta debajo */}
      <div
        className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap text-xs font-semibold px-2 py-1 rounded-md border border-line bg-surface ${
          isLocked ? 'text-fg-muted' : 'text-fg group-hover:border-primary'
        }`}
        aria-hidden="true"
      >
        {node.title}
      </div>

      <style jsx>{`
        @keyframes map-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .map-float { animation: map-float 2s ease-in-out infinite; }
      `}</style>
    </button>
  );
}

// ── Modal de detalle ──
export function NodeDetailModal({ node, meta, onClose }: { node: MapNode; meta: Meta; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // onClose cambia en cada render del mapa (el parallax lo renderiza al mover el mouse): se guarda en un ref para que el
  // efecto corra UNA sola vez y no le robe el foco al usuario.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Teclado: Escape cierra, el foco entra al dialogo y al cerrar vuelve al nodo que lo abrio.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="theme-scope fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="node-title"
        className="relative max-w-md w-full bg-surface border border-line rounded-3xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera: el color de la categoria es un acento, el texto va sobre la superficie */}
        <div className="p-6 text-center bg-surface-2 border-t-8" style={{ borderTopColor: meta.color }}>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute top-4 right-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-muted hover:text-fg hover:bg-surface"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
          <div aria-hidden="true" className="text-6xl mb-2">{meta.emoji}</div>
          <div className="text-xs font-semibold text-fg-muted uppercase tracking-wider">{meta.label}</div>
          <h2 id="node-title" className="text-2xl font-bold text-fg mt-1">{node.title}</h2>
        </div>

        {/* Contenido */}
        <div className="p-6 space-y-4">
          <dl className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-surface-2 rounded-xl border border-line">
              <dt className="text-xs text-fg-muted mb-1">Dificultad</dt>
              <dd className="flex justify-center gap-0.5" aria-label={`${node.difficulty} de 3`}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <Star
                    key={i}
                    aria-hidden="true"
                    className={`w-4 h-4 ${i < node.difficulty ? 'text-accent fill-accent' : 'text-line-strong'}`}
                  />
                ))}
              </dd>
            </div>
            <div className="text-center p-3 bg-surface-2 rounded-xl border border-line">
              <dt className="text-xs text-fg-muted mb-1">Mejor puntaje</dt>
              <dd className="text-lg font-bold text-fg">{node.score !== null ? `${node.score}` : '—'}</dd>
            </div>
            <div className="text-center p-3 bg-surface-2 rounded-xl border border-line">
              <dt className="text-xs text-fg-muted mb-1">Progreso</dt>
              <dd className="text-lg font-bold text-fg">{node.completionPct}%</dd>
            </div>
          </dl>

          {/* CTA */}
          <Link
            href={`/lesson/${node.id}`}
            className={`block w-full min-h-[48px] py-3.5 text-center font-bold rounded-2xl transition motion-reduce:transition-none ${
              node.status === 'completed'
                ? 'border-2 border-primary text-primary-text hover:bg-primary/10'
                : 'bg-primary text-on-primary hover:opacity-90'
            }`}
          >
            {node.status === 'completed' ? 'Repasar lección' : node.status === 'in_progress' ? 'Continuar lección' : '¡Empezar!'}
          </Link>

          <button type="button" onClick={onClose} className="block w-full min-h-[44px] py-2 text-center text-sm text-fg-muted hover:text-fg transition">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
