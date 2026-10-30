// Estado de la memoria tal como lo muestra el panel del profesor. Sin React ni red.

import { STALE_GENERATING_MS } from '@/lib/study/constants';
import type { Concept, ConceptKind, Edge } from './types';
import { CONCEPT_KINDS } from './types';

export interface MemoryStats {
  concepts?: number;
  edges?: number;
  materials?: number;
  materialsRead?: number;
  materialsPartial?: number;
  materialsPending?: number;
  materialsFailed?: number;
  groupsDone?: number;
  groupsTotal?: number;
  incomplete?: boolean;
  reused?: number;
}

export interface MemorySummary {
  // 'none': aun no se ha construido (o la migracion no esta aplicada).
  status: 'none' | 'building' | 'ready' | 'failed';
  version: number;
  builtAt: string | null;
  startedAt: string | null;
  error: string | null;
  stats: MemoryStats | null;
}

export const NO_MEMORY: MemorySummary = { status: 'none', version: 0, builtAt: null, startedAt: null, error: null, stats: null };

// Una construccion "en curso" mas vieja que esto se considera caida (la funcion se corto).
export function isStale(s: MemorySummary, now: number): boolean {
  return s.status === 'building' && !!s.startedAt && now - new Date(s.startedAt).getTime() >= STALE_GENERATING_MS;
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger';

// Lo leido hasta ahora, en numeros para mostrar.
export function progress(s: MemorySummary): { read: number; total: number; groupsDone: number; groupsTotal: number; percent: number } | null {
  const st = s.stats;
  if (!st || !st.materials) return null;
  const groupsTotal = st.groupsTotal ?? 0;
  const groupsDone = st.groupsDone ?? 0;
  return { read: st.materialsRead ?? 0, total: st.materials, groupsDone, groupsTotal, percent: groupsTotal > 0 ? Math.min(100, Math.round((groupsDone / groupsTotal) * 100)) : 0 };
}

export function headline(s: MemorySummary, now: number): { tone: Tone; text: string } {
  if (s.status === 'none') return { tone: 'neutral', text: 'Todavía no hay memoria de esta clase. Constrúyela para que la IA conozca tus materiales.' };
  if (isStale(s, now)) return { tone: 'warn', text: 'La construcción se interrumpió. Vuelve a intentarlo.' };
  const p = progress(s);
  if (s.status === 'building') {
    return { tone: 'neutral', text: p && p.groupsTotal > 0 ? `La IA está leyendo tus materiales… ${p.groupsDone} de ${p.groupsTotal} bloques.` : 'La IA está leyendo tus materiales… puede tardar un par de minutos.' };
  }
  if (s.status === 'failed') return { tone: 'danger', text: s.error ?? 'No se pudo construir la memoria.' };
  const n = s.stats?.concepts ?? 0;
  if (n === 0) return { tone: 'warn', text: 'La memoria está vacía: los materiales no tienen conceptos que la IA pueda extraer. Sube un material con texto explicativo.' };
  const base = `La IA conoce ${n} ${n === 1 ? 'concepto' : 'conceptos'} de esta clase.`;
  return s.error ? { tone: 'warn', text: `${base} ${s.error}` } : { tone: 'ok', text: base };
}

// ¿Hay que pedir otra pasada? Solo si falta leer, el MISMO profesor la inicio (no se arranca sola al abrir la pagina), y la anterior avanzo (si no, se corta: no se gasta IA en vano).
export const MAX_AUTO_RUNS = 12;
export function shouldContinue(lastGroupsDone: number, next: MemorySummary, runs: number): boolean {
  if (next.status !== 'ready' || !next.stats?.incomplete || runs >= MAX_AUTO_RUNS) return false;
  return (next.stats.groupsDone ?? 0) > lastGroupsDone;
}

// Los conceptos agrupados por tipo, en un orden fijo y del mas importante al menos.
export function groupConcepts(concepts: Concept[]): { kind: ConceptKind; items: Concept[] }[] {
  return CONCEPT_KINDS.map((kind) => ({
    kind,
    items: concepts.filter((c) => c.kind === kind).sort((a, b) => b.importance - a.importance || b.mentions - a.mentions || (a.name < b.name ? -1 : 1)),
  })).filter((g) => g.items.length > 0);
}

export interface TreeNode {
  concept: Concept;
  children: TreeNode[];
}

// Cuantas partes tiene un tema contando todos los niveles.
export function countParts(n: TreeNode): number {
  return n.children.reduce((s, c) => s + 1 + countParts(c), 0);
}

// Los conceptos como TEMAS con sus partes: lo que "es parte de" o "ocurre en" otro cuelga de el. Los datos sueltos (poca importancia y sin ninguna relacion) van aparte.
export function buildTree(concepts: Concept[], edges: Edge[]): { roots: TreeNode[]; minor: Concept[] } {
  const byKey: Record<string, Concept> = Object.create(null);
  concepts.forEach((c) => {
    byKey[c.key] = c;
  });
  const better = (a: Concept, b: Concept) => b.importance - a.importance || b.mentions - a.mentions || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  // El padre de cada concepto: entre los que lo contienen, el mas importante.
  const candidates: Record<string, Concept[]> = Object.create(null);
  const degree: Record<string, number> = Object.create(null);
  edges.forEach((e) => {
    if (!byKey[e.from] || !byKey[e.to]) return;
    degree[e.from] = (degree[e.from] ?? 0) + 1;
    degree[e.to] = (degree[e.to] ?? 0) + 1;
    if (e.relation === 'parte_de' || e.relation === 'ocurre_en') (candidates[e.from] = candidates[e.from] ?? []).push(byKey[e.to]);
  });
  const parent: Record<string, string> = Object.create(null);
  Object.keys(candidates).forEach((k) => {
    const p = candidates[k].slice().sort(better)[0];
    if (p && p.key !== k) parent[k] = p.key;
  });
  // Un ciclo de contenciones (A en B, B en A) no es un arbol: se corta donde se cierra.
  Object.keys(parent).forEach((k) => {
    let cur = parent[k];
    let hops = 0;
    while (cur && hops++ < concepts.length) {
      if (cur === k) {
        delete parent[k];
        break;
      }
      cur = parent[cur];
    }
  });

  const kids: Record<string, Concept[]> = Object.create(null);
  concepts.forEach((c) => {
    if (parent[c.key]) (kids[parent[c.key]] = kids[parent[c.key]] ?? []).push(c);
  });
  // Cada tema con TODAS sus partes, en varios niveles (Mesopotamia > ciudades-estado > Ur). Un tope de profundidad evita cualquier bucle.
  const node = (c: Concept, depth: number): TreeNode => ({ concept: c, children: depth >= 6 ? [] : (kids[c.key] ?? []).slice().sort(better).map((k) => node(k, depth + 1)) });
  const roots: TreeNode[] = [];
  const minor: Concept[] = [];
  concepts
    .filter((c) => !parent[c.key])
    .forEach((c) => {
      if (!kids[c.key] && c.importance <= 2 && !degree[c.key]) minor.push(c);
      else roots.push(node(c, 0));
    });
  roots.sort((a, b) => b.concept.importance - a.concept.importance || countParts(b) - countParts(a) || (a.concept.name < b.concept.name ? -1 : 1));
  return { roots, minor: minor.sort(better) };
}
