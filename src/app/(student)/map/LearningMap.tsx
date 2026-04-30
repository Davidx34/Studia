'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTonitoStore } from '@/stores/useTonitoStore';
import { Lock, Star, Sparkles, ChevronDown } from 'lucide-react';
import type { MapNode, NodeStatus } from './page';

interface Props {
  nodes: MapNode[];
  categoryMeta: Record<string, { label: string; color: string; emoji: string; gradient: [string, string] }>;
  stats: { total: number; completed: number };
}

const VIEWBOX_W = 1000;
const VIEWBOX_H = 1600;

export function LearningMap({ nodes, categoryMeta, stats }: Props) {
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null);
  const showMessage = useTonitoStore((s) => s.showMessage);
  const setMood = useTonitoStore((s) => s.setMood);
  const containerRef = useRef<HTMLDivElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  // Saludo de Toñito al entrar al mapa
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = nodes.find((n) => n.status === 'in_progress' || n.status === 'available');
      if (next) {
        showMessage(`¡Tu siguiente parada es "${next.title}"! 🗺️`, 5000);
      } else {
        showMessage('¡Explora todas las islas del mapa! 🌟', 4000);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [nodes, showMessage]);

  // Parallax sutil con el mouse
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
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
        const dy = n.y - prereq.y;
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
    <div className="space-y-4">
      {/* Header del mapa */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-yellow-300" /> Mapa de Aprendizaje
          </h2>
          <p className="text-sm text-white/60 mt-1">
            {stats.completed} de {stats.total} módulos completados
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/70">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-400" /> Completado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-yellow-300 animate-pulse" /> Actual
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-white/40" /> Disponible
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-slate-600" /> Bloqueado
          </span>
        </div>
      </div>

      {/* Hint de scroll */}
      <div className="flex items-center justify-center gap-2 text-xs text-white/50">
        <ChevronDown className="w-4 h-4 animate-bounce" />
        Desplázate para explorar todas las islas
      </div>

      {/* Container del mapa */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setParallax({ x: 0, y: 0 })}
        className="relative w-full backdrop-blur-xl bg-white/5 border border-white/15 rounded-3xl overflow-hidden"
        style={{ aspectRatio: `${VIEWBOX_W}/${VIEWBOX_H}` }}
      >
        {/* SVG de fondo: caminos + decoración */}
        <svg
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="xMidYMid meet"
          style={{ transform: `translate(${parallax.x * -0.5}px, ${parallax.y * -0.5}px)`, transition: 'transform 0.3s ease-out' }}
        >
          <defs>
            <pattern id="dotPattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="1.5" fill="rgba(255,255,255,0.08)" />
            </pattern>
            <filter id="pathGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Fondo punteado */}
          <rect width={VIEWBOX_W} height={VIEWBOX_H} fill="url(#dotPattern)" />

          {/* "Islas" — bandas suaves de fondo por categoría */}
          {islandHeaders.map((island) => {
            const meta = categoryMeta[island.category];
            return (
              <g key={`island-${island.category}`}>
                <ellipse
                  cx={VIEWBOX_W / 2}
                  cy={(island.minY + island.maxY) / 2}
                  rx={VIEWBOX_W * 0.45}
                  ry={(island.maxY - island.minY) / 2 + 80}
                  fill={meta.color}
                  opacity="0.06"
                />
              </g>
            );
          })}

          {/* Caminos curvos entre nodos */}
          {paths.map((p) => (
            <path
              key={p.id}
              d={p.d}
              fill="none"
              stroke={p.unlocked ? 'rgba(253,224,71,0.7)' : 'rgba(255,255,255,0.15)'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={p.unlocked ? '0' : '12 8'}
              filter={p.unlocked ? 'url(#pathGlow)' : undefined}
            />
          ))}
        </svg>

        {/* Headers de isla (HTML para mejor tipografía) */}
        {islandHeaders.map((island) => {
          const meta = categoryMeta[island.category];
          const xPct = 50;
          const yPct = (island.headerY / VIEWBOX_H) * 100;
          return (
            <div
              key={`header-${island.category}`}
              className="absolute pointer-events-none"
              style={{
                left: `${xPct}%`,
                top: `${yPct}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div
                className="backdrop-blur-md bg-white/10 border border-white/20 rounded-full px-5 py-2 flex items-center gap-2 shadow-2xl"
                style={{ borderColor: `${meta.color}66` }}
              >
                <span className="text-2xl">{meta.emoji}</span>
                <div>
                  <div className="text-sm font-bold text-white leading-tight">{meta.label}</div>
                  <div className="text-[10px] text-white/70 leading-tight">
                    {island.completed}/{island.count} completados
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Nodos (HTML absolutos sobre el SVG) */}
        {nodes.map((node) => (
          <MapNodeButton
            key={node.id}
            node={node}
            meta={categoryMeta[node.category]}
            onClick={() => {
              if (node.status === 'locked') {
                setMood('thinking');
                showMessage('¡Aún no puedes! Termina los anteriores 🔒', 3000);
                return;
              }
              setSelectedNode(node);
            }}
            parallax={parallax}
          />
        ))}
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
}: {
  node: MapNode;
  meta: { label: string; color: string; emoji: string; gradient: [string, string] };
  onClick: () => void;
  parallax: { x: number; y: number };
}) {
  const xPct = (node.x / VIEWBOX_W) * 100;
  const yPct = (node.y / VIEWBOX_H) * 100;

  const isLocked = node.status === 'locked';
  const isCompleted = node.status === 'completed';
  const isInProgress = node.status === 'in_progress';
  const isAvailable = node.status === 'available';

  return (
    <button
      onClick={onClick}
      className={`absolute group ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: `translate(-50%, -50%) translate(${parallax.x}px, ${parallax.y}px)`,
        transition: 'transform 0.3s ease-out',
      }}
    >
      {/* Pulso para el "current" */}
      {isInProgress && (
        <div
          className="absolute inset-0 rounded-full animate-ping"
          style={{ background: 'rgba(253,224,71,0.4)', transform: 'scale(1.4)' }}
        />
      )}

      {/* Círculo principal */}
      <div
        className={`relative w-20 h-20 rounded-full flex items-center justify-center font-bold text-2xl transition-all border-4 shadow-2xl ${
          isLocked ? 'opacity-40 scale-90' : 'group-hover:scale-110 group-active:scale-95'
        } ${isInProgress ? 'animate-float' : ''}`}
        style={{
          background: isLocked
            ? 'rgba(50,50,70,0.6)'
            : isCompleted
            ? `linear-gradient(135deg, ${meta.gradient[0]}, ${meta.gradient[1]})`
            : isInProgress
            ? 'linear-gradient(135deg, #fde047, #fb923c)'
            : `linear-gradient(135deg, ${meta.gradient[0]}aa, ${meta.gradient[1]}aa)`,
          borderColor: isCompleted
            ? '#10b981'
            : isInProgress
            ? '#fbbf24'
            : isLocked
            ? 'rgba(255,255,255,0.15)'
            : 'rgba(255,255,255,0.4)',
          boxShadow: isCompleted
            ? '0 0 30px rgba(16,185,129,0.5)'
            : isInProgress
            ? '0 0 40px rgba(253,224,71,0.7)'
            : isAvailable
            ? `0 0 25px ${meta.color}66`
            : 'none',
        }}
      >
        {isLocked ? (
          <Lock className="w-7 h-7 text-white/60" />
        ) : isCompleted ? (
          <div className="relative">
            <Star className="w-9 h-9 text-yellow-300 fill-yellow-300" />
            {node.score === 100 && (
              <span className="absolute -top-1 -right-2 text-[10px] font-bold text-emerald-900 bg-yellow-300 rounded-full px-1">
                100
              </span>
            )}
          </div>
        ) : (
          <span>{meta.emoji}</span>
        )}
      </div>

      {/* Etiqueta debajo */}
      <div
        className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap text-xs font-semibold px-2 py-1 rounded-md backdrop-blur-md transition ${
          isLocked
            ? 'bg-black/30 text-white/40'
            : 'bg-black/40 text-white group-hover:bg-black/60'
        }`}
      >
        {node.title}
      </div>

      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .animate-float { animation: float 2s ease-in-out infinite; }
      `}</style>
    </button>
  );
}

// ── Modal de detalle ──
function NodeDetailModal({
  node,
  meta,
  onClose,
}: {
  node: MapNode;
  meta: { label: string; color: string; emoji: string; gradient: [string, string] };
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative max-w-md w-full backdrop-blur-2xl bg-white/15 border border-white/30 rounded-3xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header colorido */}
        <div
          className="p-6 text-center relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${meta.gradient[0]}, ${meta.gradient[1]})`,
          }}
        >
          <div className="absolute inset-0 bg-black/10" />
          <div className="relative">
            <div className="text-6xl mb-2">{meta.emoji}</div>
            <div className="text-xs font-semibold text-white/80 uppercase tracking-wider">
              {meta.label}
            </div>
            <h3 className="text-2xl font-bold text-white mt-1">{node.title}</h3>
          </div>
        </div>

        {/* Contenido */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-white/10 rounded-xl border border-white/15">
              <div className="text-xs text-white/60 mb-1">Dificultad</div>
              <div className="flex justify-center gap-0.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <span
                    key={i}
                    className={i < node.difficulty ? 'text-yellow-300' : 'text-white/20'}
                  >
                    ★
                  </span>
                ))}
              </div>
            </div>
            <div className="text-center p-3 bg-white/10 rounded-xl border border-white/15">
              <div className="text-xs text-white/60 mb-1">Mejor puntaje</div>
              <div className="text-lg font-bold text-white">
                {node.score !== null ? `${node.score}` : '—'}
              </div>
            </div>
            <div className="text-center p-3 bg-white/10 rounded-xl border border-white/15">
              <div className="text-xs text-white/60 mb-1">Progreso</div>
              <div className="text-lg font-bold text-white">{node.completionPct}%</div>
            </div>
          </div>

          {/* CTA */}
          <Link
            href={`/lesson/${node.id}`}
            className="block w-full py-4 text-center font-bold text-white rounded-2xl shadow-xl hover:scale-[1.02] active:scale-[0.98] transition"
            style={{
              background:
                node.status === 'completed'
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : `linear-gradient(135deg, ${meta.gradient[0]}, ${meta.gradient[1]})`,
            }}
          >
            {node.status === 'completed'
              ? '✓ Repasar lección'
              : node.status === 'in_progress'
              ? 'Continuar lección'
              : '¡Empezar!'}
          </Link>

          <button
            onClick={onClose}
            className="block w-full py-2 text-center text-sm text-white/60 hover:text-white transition"
          >
            Cerrar
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .animate-fade-in { animation: fade-in 0.2s ease-out; }
      `}</style>
    </div>
  );
}
