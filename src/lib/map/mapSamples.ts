// Datos para las vistas previas del selector del profesor (sin React): los metadatos de los temas conocidos y un mapa de ejemplo, o uno armado con los modulos
// REALES de la clase simulando un avance (asi el profesor ve su propio contenido en cada plantilla).

import type { CategoryMeta, MapNode } from './types';

export const CATEGORY_META: Record<string, CategoryMeta> = {
  math: { label: 'Matemáticas', color: '#6C5CE7', emoji: '🔢', gradient: ['#6C5CE7', '#a29bfe'] },
  science: { label: 'Ciencias', color: '#00D2D3', emoji: '🔬', gradient: ['#00D2D3', '#55E6C1'] },
  language: { label: 'Lenguaje', color: '#FF7675', emoji: '📖', gradient: ['#FF7675', '#fab1a0'] },
  history: { label: 'Historia', color: '#FDCB6E', emoji: '📜', gradient: ['#FDCB6E', '#ffeaa7'] },
  logic: { label: 'Lógica', color: '#A29BFE', emoji: '🧩', gradient: ['#A29BFE', '#dfe6e9'] },
};

const node = (id: string, title: string, category: string, order: number, over: Partial<MapNode>): MapNode => ({
  id, title, category, difficulty: 1, order, x: 500, y: 200 + order * 120, prerequisites: [], status: 'available', score: null, completionPct: 0, isCurrent: false, ...over,
});

// Un mapa de ejemplo con los cuatro estados.
export const SAMPLE_MAP_NODES: MapNode[] = [
  node('s1', 'Los números', 'math', 1, { status: 'completed', score: 95, completionPct: 100, x: 300, y: 220 }),
  node('s2', 'Sumas y restas', 'math', 2, { status: 'completed', score: 80, completionPct: 100, difficulty: 2, prerequisites: ['s1'], x: 620, y: 340 }),
  node('s3', 'Fracciones', 'math', 3, { status: 'in_progress', completionPct: 40, difficulty: 2, prerequisites: ['s2'], isCurrent: true, x: 380, y: 460 }),
  node('s4', 'Geometría', 'math', 4, { status: 'available', difficulty: 3, prerequisites: ['s2'], x: 700, y: 580 }),
  node('s5', 'La célula', 'science', 1, { status: 'available', x: 300, y: 820 }),
  node('s6', 'Los ecosistemas', 'science', 2, { status: 'locked', difficulty: 2, prerequisites: ['s5'], x: 640, y: 940 }),
  node('s7', 'La energía', 'science', 3, { status: 'locked', difficulty: 3, prerequisites: ['s6'], x: 360, y: 1060 }),
];

export interface PreviewModule {
  id: string;
  title: string;
  category: string;
  difficulty_level: number | null;
  order_index: number | null;
  map_position_x: number | null;
  map_position_y: number | null;
  prerequisites: unknown;
}

const MAX_PREVIEW = 8;

// Con los modulos reales de la clase se arma una vista previa con un avance simulado: el primero completado, el segundo en curso, el tercero disponible y el resto
// bloqueado. Con menos de 3 modulos no alcanza para mostrar los estados: se usa el ejemplo. Devuelve tambien si son reales, para avisar al profesor.
export function previewNodes(modules: PreviewModule[]): { nodes: MapNode[]; real: boolean } {
  if (modules.length < 3) return { nodes: SAMPLE_MAP_NODES, real: false };
  const sorted = [...modules].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).slice(0, MAX_PREVIEW);
  const nodes = sorted.map((m, i): MapNode => ({
    id: m.id,
    title: m.title,
    category: m.category,
    difficulty: m.difficulty_level ?? 1,
    order: m.order_index ?? i,
    x: m.map_position_x ?? 500,
    y: m.map_position_y ?? 200 + i * 120,
    prerequisites: (Array.isArray(m.prerequisites) ? m.prerequisites : []).filter((p): p is string => typeof p === 'string' && sorted.some((s) => s.id === p)),
    status: i === 0 ? 'completed' : i === 1 ? 'in_progress' : i === 2 ? 'available' : 'locked',
    score: i === 0 ? 90 : null,
    completionPct: i === 0 ? 100 : i === 1 ? 40 : 0,
    isCurrent: i === 1,
  }));
  return { nodes, real: true };
}
