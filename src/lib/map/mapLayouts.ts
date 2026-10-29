// Disposicion de los modulos para las plantillas del mapa (sin React, para poder probarla). El mapa de islas usa las posiciones que guardo la IA (x, y); las demas
// plantillas NO dependen de ellas: recorren los modulos en un orden que respeta los prerrequisitos y los acomodan por su cuenta, asi se ven bien aunque las
// posiciones de la IA sean malas o falten.

import type { MapNode } from './types';

const byOrder = (a: MapNode, b: MapNode) => a.order - b.order || a.title.localeCompare(b.title, 'es') || a.id.localeCompare(b.id);

// Orden de recorrido: un modulo va despues de sus prerrequisitos y, a igual condicion, por su orden. Si hay ciclos o prerrequisitos que no existen (datos raros),
// lo que no se pudo ordenar se agrega al final: ningun modulo se pierde.
export function orderNodes(nodes: MapNode[]): MapNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pending = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    const pre = n.prerequisites.filter((p) => byId.has(p) && p !== n.id);
    pending.set(n.id, pre.length);
    for (const p of pre) children.set(p, [...(children.get(p) ?? []), n.id]);
  }
  const ready = nodes.filter((n) => pending.get(n.id) === 0).sort(byOrder);
  const out: MapNode[] = [];
  const seen = new Set<string>();
  while (ready.length > 0) {
    const n = ready.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    for (const c of children.get(n.id) ?? []) {
      const left = (pending.get(c) ?? 0) - 1;
      pending.set(c, left);
      if (left === 0) {
        ready.push(byId.get(c)!);
        ready.sort(byOrder);
      }
    }
  }
  for (const n of [...nodes].sort(byOrder)) if (!seen.has(n.id)) out.push(n);
  return out;
}

export interface CategoryGroup {
  category: string;
  nodes: MapNode[];
  completed: number;
  total: number;
}

// Modulos agrupados por tema (categoria), cada grupo en su orden de recorrido; los grupos van por el primer modulo que tengan.
export function groupByCategory(nodes: MapNode[]): CategoryGroup[] {
  const groups = new Map<string, MapNode[]>();
  for (const n of orderNodes(nodes)) groups.set(n.category, [...(groups.get(n.category) ?? []), n]);
  return Array.from(groups.entries()).map(([category, ns]) => ({
    category,
    nodes: ns,
    completed: ns.filter((n) => n.status === 'completed').length,
    total: ns.length,
  }));
}

export interface Placed {
  node: MapNode;
  row: number;
  col: number;
  // x en % del ancho; y en px desde arriba (centro del nodo).
  x: number;
  y: number;
}

export interface Segment {
  from: Placed;
  to: Placed;
  // 'row': tramo recto dentro de una fila. 'turn': el giro que baja de una fila a la siguiente, por el borde indicado.
  kind: 'row' | 'turn';
  side: 'left' | 'right';
}

export interface SerpentineLayout {
  placed: Placed[];
  segments: Segment[];
  height: number;
  rows: number;
}

export const SERPENTINE_ROW_H = 150;
const PAD_Y = 76;
const MARGIN_X = 15;

// Camino que serpentea: la primera fila va de izquierda a derecha, la segunda de derecha a izquierda, y asi. `cols` columnas por fila (3 en celular, 4-5 en pantalla ancha).
export function serpentine(ordered: MapNode[], cols: number, rowH = SERPENTINE_ROW_H): SerpentineLayout {
  const c = Math.max(1, Math.floor(cols));
  const placed: Placed[] = ordered.map((node, i) => {
    const row = Math.floor(i / c);
    const k = i % c;
    const col = row % 2 === 0 ? k : c - 1 - k;
    const x = c === 1 ? 50 : MARGIN_X + ((100 - 2 * MARGIN_X) * col) / (c - 1);
    return { node, row, col, x, y: PAD_Y + row * rowH };
  });
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < placed.length; i++) {
    const from = placed[i];
    const to = placed[i + 1];
    if (from.row === to.row) segments.push({ from, to, kind: 'row', side: 'right' });
    else segments.push({ from, to, kind: 'turn', side: from.row % 2 === 0 ? 'right' : 'left' });
  }
  const rows = placed.length === 0 ? 0 : placed[placed.length - 1].row + 1;
  return { placed, segments, rows, height: PAD_Y * 2 + Math.max(0, rows - 1) * rowH };
}

// Cuantas columnas caben segun el ancho disponible (px).
export function columnsFor(width: number): number {
  if (width >= 1000) return 5;
  if (width >= 700) return 4;
  return 3;
}
