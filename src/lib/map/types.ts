// Tipos del mapa de aprendizaje, compartidos por la pagina, las plantillas y las pruebas (sin React).

export type NodeStatus = 'locked' | 'available' | 'in_progress' | 'completed' | 'current';

export interface MapNode {
  id: string;
  title: string;
  category: string;
  difficulty: number;
  order: number;
  x: number;
  y: number;
  prerequisites: string[];
  status: NodeStatus;
  score: number | null;
  completionPct: number;
  isCurrent: boolean;
}

export interface CategoryMeta {
  label: string;
  color: string;
  emoji: string;
  gradient: [string, string];
}

// El estado de un nodo nunca se comunica solo con color: lleva icono Y este texto (tambien para lectores de pantalla).
export const NODE_STATUS_TEXT: Record<NodeStatus, string> = {
  completed: 'completado',
  in_progress: 'en curso',
  current: 'en curso',
  available: 'disponible',
  locked: 'bloqueado',
};

// Metadatos de un tema (nombre, color). Si el tema no esta en la lista (por ejemplo una categoria nueva), se usa uno generico: ningun modulo desaparece del mapa.
export function metaFor(meta: Record<string, CategoryMeta>, category: string): CategoryMeta {
  return meta[category] ?? { label: category, color: '#6C5CE7', emoji: '📘', gradient: ['#6C5CE7', '#a29bfe'] };
}
