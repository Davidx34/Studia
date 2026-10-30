// Fusion de lo extraido de cada material en UN grafo por clase. Dos materiales que hablan del mismo concepto (aunque con palabras algo distintas) terminan en un solo nodo con
// las fuentes de ambos; las relaciones se reasignan a ese nodo, se suman y se les rompen los ciclos. Determinista: mismos materiales, mismo grafo.

import { breakCycles } from './graph';
import { similarKeys } from './text';
import { MEMORY_LIMITS, type Concept, type ConceptKind, type Edge, type Graph, type SourceRef } from './types';

export interface MaterialGraph {
  materialId: string;
  graph: Graph;
}

export interface MergeStats {
  input: number;
  merged: number;
  cyclesBroken: number;
  dropped: number;
}

// Union-find con compresion de caminos.
function makeSets(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  return { find, union };
}

// 'concepto' y 'definicion' son casi lo mismo; el resto solo se mezcla con su propio tipo (una formula no es una variable).
function compatible(a: ConceptKind, b: ConceptKind): boolean {
  if (a === b) return true;
  const loose = (k: ConceptKind) => k === 'concepto' || k === 'definicion';
  return loose(a) && loose(b);
}

// Cuando un nodo reune varios tipos, gana el mas especifico.
const SPECIFICITY: Record<ConceptKind, number> = { formula: 9, ley: 8, variable: 7, evento: 6, persona: 6, lugar: 6, periodo: 6, obra: 6, objetivo: 3, ejemplo: 2, concepto: 1, definicion: 0 };

function mergeSources(list: SourceRef[][]): SourceRef[] {
  const byMaterial: Record<string, Record<number, true>> = {};
  for (const refs of list) {
    for (const r of refs) {
      const m = (byMaterial[r.materialId] = byMaterial[r.materialId] ?? {});
      for (const c of r.chunks) m[c] = true;
    }
  }
  return Object.keys(byMaterial)
    .sort()
    .map((materialId) => ({ materialId, chunks: Object.keys(byMaterial[materialId]).map(Number).sort((a, b) => a - b) }));
}

// blend: la importancia final mezcla lo que dijo la IA con lo CENTRAL que es el concepto en el grafo (cuantas relaciones tiene). Un dato suelto sin relaciones baja; un tema
// del que cuelgan muchos otros sube. Se aplica a la fusion de la CLASE; al unir los bloques de un solo material no (el grafo todavia esta incompleto).
export function mergeGraphs(inputs: MaterialGraph[], opts: { blend?: boolean } = {}): { graph: Graph; stats: MergeStats } {
  const blend = opts.blend !== false;
  const flat: Concept[] = [];
  for (const m of inputs) for (const c of m.graph.concepts) flat.push(c);
  const sets = makeSets(flat.length);

  // 1. Agrupar: misma clave, o nombres muy parecidos del mismo tipo. Se compara por orden de clave para que el resultado no dependa del orden de los materiales.
  const order = flat.map((_, i) => i).sort((a, b) => (flat[a].key < flat[b].key ? -1 : flat[a].key > flat[b].key ? 1 : 0));
  for (let x = 0; x < order.length; x++) {
    for (let y = x + 1; y < order.length; y++) {
      const a = flat[order[x]];
      const b = flat[order[y]];
      if (!compatible(a.kind, b.kind) && a.key !== b.key) continue;
      if (similarKeys(a.key, b.key, MEMORY_LIMITS.tokenSimilarity)) sets.union(order[x], order[y]);
    }
  }

  const clusters: Record<number, number[]> = {};
  flat.forEach((_, i) => {
    const r = sets.find(i);
    (clusters[r] = clusters[r] ?? []).push(i);
  });

  // 2. Un concepto por grupo.
  const keyMap: Record<string, string> = {};
  const merged: Concept[] = [];
  for (const root of Object.keys(clusters)) {
    const members = clusters[Number(root)].map((i) => flat[i]);
    const canonical = members.slice().sort((a, b) => b.definition.length - a.definition.length || b.mentions - a.mentions || (a.key < b.key ? -1 : 1))[0];
    const kind = members.map((m) => m.kind).sort((a, b) => SPECIFICITY[b] - SPECIFICITY[a])[0];
    const sources = mergeSources(members.map((m) => m.sources));
    const longest = (pick: (c: Concept) => string) => members.map(pick).sort((a, b) => b.length - a.length)[0] ?? '';
    const concept: Concept = {
      key: canonical.key,
      name: canonical.name,
      kind,
      definition: longest((c) => c.definition).slice(0, MEMORY_LIMITS.definition),
      formula: longest((c) => c.formula).slice(0, MEMORY_LIMITS.formula),
      unit: longest((c) => c.unit).slice(0, MEMORY_LIMITS.unit),
      // Lo que aparece en varios materiales es mas central.
      importance: Math.min(5, Math.max(...members.map((m) => m.importance)) + (sources.length > 1 ? 1 : 0)),
      mentions: members.reduce((s, m) => s + m.mentions, 0),
      sources,
    };
    merged.push(concept);
    for (const m of members) keyMap[m.key] = concept.key;
  }

  // 3. Si hay demasiados, se queda lo mas importante y mencionado.
  merged.sort((a, b) => b.importance * 10 + b.mentions - (a.importance * 10 + a.mentions) || (a.key < b.key ? -1 : 1));
  const kept = merged.slice(0, MEMORY_LIMITS.conceptsPerClass);
  const dropped = merged.length - kept.length;
  kept.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const present: Record<string, true> = {};
  kept.forEach((c) => {
    present[c.key] = true;
  });

  // 4. Relaciones: reasignar a los nodos fusionados, sumar repetidas y descartar lazos y huerfanas.
  const acc: Record<string, Edge> = {};
  for (const m of inputs) {
    for (const e of m.graph.edges) {
      const from = keyMap[e.from];
      const to = keyMap[e.to];
      if (!from || !to || from === to || !present[from] || !present[to]) continue;
      const id = from + '\u0000' + to + '\u0000' + e.relation;
      if (acc[id]) acc[id].weight += e.weight;
      else acc[id] = { from, to, relation: e.relation, weight: e.weight };
    }
  }
  const all = Object.keys(acc)
    .sort()
    .map((id) => acc[id]);
  const { edges, removed } = breakCycles(kept.map((c) => c.key), all);
  const trimmed = edges.sort((a, b) => b.weight - a.weight).slice(0, MEMORY_LIMITS.edgesPerClass);

  if (blend) {
    const deg: Record<string, number> = Object.create(null);
    trimmed.forEach((e) => {
      deg[e.from] = (deg[e.from] ?? 0) + 1;
      deg[e.to] = (deg[e.to] ?? 0) + 1;
    });
    let maxDeg = 1;
    kept.forEach((c) => {
      maxDeg = Math.max(maxDeg, deg[c.key] ?? 0);
    });
    kept.forEach((c) => {
      const central = 1 + 4 * ((deg[c.key] ?? 0) / maxDeg);
      c.importance = Math.min(5, Math.max(1, Math.round(0.6 * c.importance + 0.4 * central)));
    });
  }

  return { graph: { concepts: kept, edges: trimmed }, stats: { input: flat.length, merged: kept.length, cyclesBroken: removed.length, dropped } };
}
