// Lee el grafo guardado en la base (jsonb) sin confiar en el: cada concepto y relacion se vuelve a comprobar y lo corrupto se descarta. Sin red.

import { CONCEPT_KINDS, MEMORY_LIMITS, RELATIONS, type Concept, type ConceptKind, type Edge, type Graph, type Relation, type SourceRef } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function readGraph(raw: unknown): Graph {
  if (!isObj(raw)) return { concepts: [], edges: [] };
  const concepts: Concept[] = [];
  const keys: Record<string, true> = Object.create(null);
  for (const c of Array.isArray(raw.concepts) ? raw.concepts.slice(0, MEMORY_LIMITS.conceptsPerClass) : []) {
    if (!isObj(c)) continue;
    const key = str(c.key, 80);
    const name = str(c.name, MEMORY_LIMITS.name);
    if (!key || !name || keys[key]) continue;
    keys[key] = true;
    const sources: SourceRef[] = [];
    for (const s of Array.isArray(c.sources) ? c.sources.slice(0, 20) : []) {
      if (!isObj(s) || typeof s.materialId !== 'string') continue;
      sources.push({ materialId: s.materialId, chunks: (Array.isArray(s.chunks) ? s.chunks : []).filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).slice(0, 50) });
    }
    const imp = typeof c.importance === 'number' && Number.isFinite(c.importance) ? Math.round(c.importance) : 3;
    concepts.push({
      key,
      name,
      kind: (CONCEPT_KINDS as readonly string[]).indexOf(String(c.kind)) >= 0 ? (c.kind as ConceptKind) : 'concepto',
      definition: str(c.definition, MEMORY_LIMITS.definition),
      formula: str(c.formula, MEMORY_LIMITS.formula),
      unit: str(c.unit, MEMORY_LIMITS.unit),
      importance: Math.min(5, Math.max(1, imp)),
      mentions: typeof c.mentions === 'number' && Number.isFinite(c.mentions) ? Math.max(1, Math.round(c.mentions)) : 1,
      sources,
    });
  }
  const edges: Edge[] = [];
  for (const e of Array.isArray(raw.edges) ? raw.edges.slice(0, MEMORY_LIMITS.edgesPerClass) : []) {
    if (!isObj(e) || typeof e.from !== 'string' || typeof e.to !== 'string' || !keys[e.from] || !keys[e.to] || e.from === e.to) continue;
    edges.push({
      from: e.from,
      to: e.to,
      relation: (RELATIONS as readonly string[]).indexOf(String(e.relation)) >= 0 ? (e.relation as Relation) : 'relacionado',
      weight: typeof e.weight === 'number' && Number.isFinite(e.weight) ? e.weight : 1,
    });
  }
  return { concepts, edges };
}
