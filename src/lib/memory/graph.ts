// Algoritmos sobre el grafo de la memoria: orden topologico de prerrequisitos, rotura de ciclos, cierre transitivo e indice invertido para buscar conceptos. Sin red.

import { words } from './text';
import type { Concept, Edge, Graph } from './types';

// "A requiere B" (from=A, to=B). Los prerrequisitos son las aristas 'requiere'; las demas relaciones no ordenan.
function requireEdges(edges: Edge[]): Edge[] {
  return edges.filter((e) => e.relation === 'requiere');
}

// Orden de estudio: primero lo que no necesita nada, luego lo que depende de eso (Kahn). Lo que queda atrapado en un ciclo se devuelve aparte.
export function studyOrder(keys: string[], edges: Edge[]): { order: string[]; cyclic: string[] } {
  const pending: Record<string, number> = {};
  const dependents: Record<string, string[]> = {};
  const known: Record<string, true> = {};
  for (const k of keys) {
    known[k] = true;
    pending[k] = 0;
  }
  const seen: Record<string, true> = {};
  for (const e of requireEdges(edges)) {
    if (!known[e.from] || !known[e.to] || e.from === e.to) continue;
    const id = e.from + '\u0000' + e.to;
    if (seen[id]) continue;
    seen[id] = true;
    pending[e.from]++;
    (dependents[e.to] = dependents[e.to] ?? []).push(e.from);
  }
  // Cola ordenada alfabeticamente en cada nivel para que el resultado sea estable.
  let ready = keys.filter((k) => pending[k] === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const next: string[] = [];
    for (const k of ready) {
      order.push(k);
      for (const d of dependents[k] ?? []) if (--pending[d] === 0) next.push(d);
    }
    ready = next.sort();
  }
  const done: Record<string, true> = {};
  order.forEach((k) => {
    done[k] = true;
  });
  return { order, cyclic: keys.filter((k) => !done[k]).sort() };
}

// Un ciclo de prerrequisitos (A requiere B y B requiere A) no tiene sentido: se rompe quitando la arista MAS DEBIL de lo que quede atrapado, hasta que no haya ciclos.
export function breakCycles(keys: string[], edges: Edge[]): { edges: Edge[]; removed: Edge[] } {
  let current = edges.slice();
  const removed: Edge[] = [];
  for (let guard = 0; guard < edges.length + 1; guard++) {
    const { cyclic } = studyOrder(keys, current);
    if (cyclic.length === 0) break;
    const inCycle: Record<string, true> = {};
    cyclic.forEach((k) => {
      inCycle[k] = true;
    });
    let worst = -1;
    current.forEach((e, i) => {
      if (e.relation !== 'requiere' || !inCycle[e.from] || !inCycle[e.to]) return;
      if (worst === -1) return void (worst = i);
      const w = current[worst];
      if (e.weight < w.weight || (e.weight === w.weight && e.from + e.to > w.from + w.to)) worst = i;
    });
    if (worst === -1) break;
    removed.push(current[worst]);
    current = current.filter((_, i) => i !== worst);
  }
  return { edges: current, removed };
}

// Todo lo que hay que saber antes de un concepto (cierre transitivo de 'requiere'), en orden de estudio. No incluye al propio concepto.
export function prerequisitesOf(graph: Graph, key: string): string[] {
  const requires: Record<string, string[]> = {};
  for (const e of requireEdges(graph.edges)) (requires[e.from] = requires[e.from] ?? []).push(e.to);
  const seen: Record<string, true> = {};
  const stack = (requires[key] ?? []).slice();
  while (stack.length > 0) {
    const k = stack.pop() as string;
    if (seen[k] || k === key) continue;
    seen[k] = true;
    for (const n of requires[k] ?? []) stack.push(n);
  }
  const { order } = studyOrder(Object.keys(seen), graph.edges);
  return order;
}

// ---------------------------------------------------------------- busqueda (indice invertido con idf)

export interface ConceptIndex {
  // palabra -> conceptos que la contienen, con su peso (el nombre pesa mas que la definicion).
  postings: Record<string, { key: string; w: number }[]>;
  idf: Record<string, number>;
  size: number;
}

export function buildIndex(concepts: Concept[]): ConceptIndex {
  const postings: Record<string, { key: string; w: number }[]> = {};
  const docFreq: Record<string, number> = {};
  for (const c of concepts) {
    const weights: Record<string, number> = {};
    for (const w of words(c.name)) weights[w] = Math.max(weights[w] ?? 0, 3);
    for (const w of words(c.formula)) weights[w] = Math.max(weights[w] ?? 0, 2);
    for (const w of words(c.definition)) weights[w] = Math.max(weights[w] ?? 0, 1);
    for (const w of Object.keys(weights)) {
      (postings[w] = postings[w] ?? []).push({ key: c.key, w: weights[w] });
      docFreq[w] = (docFreq[w] ?? 0) + 1;
    }
  }
  const idf: Record<string, number> = {};
  const n = concepts.length;
  for (const w of Object.keys(docFreq)) idf[w] = Math.log(1 + (n - docFreq[w] + 0.5) / (docFreq[w] + 0.5));
  return { postings, idf, size: n };
}

export interface Hit {
  key: string;
  // 0 a 1: que parte del peso (idf) de la consulta encuentra el concepto, premiando que este en el nombre.
  score: number;
}

// Busca conceptos para un texto. El puntaje 1 significa que todas las palabras (con peso) de la consulta estan en el nombre del concepto.
export function searchConcepts(index: ConceptIndex, query: string, limit: number = 5): Hit[] {
  const qs = words(query);
  if (qs.length === 0) return [];
  const uniq: Record<string, true> = {};
  const terms = qs.filter((w) => (uniq[w] ? false : (uniq[w] = true)));
  let total = 0;
  const acc: Record<string, number> = {};
  for (const w of terms) {
    const idf = index.idf[w] ?? Math.log(1 + index.size + 0.5);
    total += idf * 3;
    for (const p of index.postings[w] ?? []) acc[p.key] = (acc[p.key] ?? 0) + idf * p.w;
  }
  if (total === 0) return [];
  return Object.keys(acc)
    .map((key) => ({ key, score: Math.min(1, acc[key] / total) }))
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1))
    .slice(0, limit);
}
