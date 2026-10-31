// Piezas puras de la recuperacion: fusion de rankings, corte por relevancia, descarte de repetidos y empaquetado en un
// presupuesto de caracteres. Sin base de datos ni red, para poder probarlas y afinarlas con el banco de evaluacion.

export interface Retrieved {
  chunk_id: string;
  content: string;
  material_id: string;
  chunk_index: number;
  filename?: string | null;
  // Puntaje de la busqueda de UNA consulta (RRF de vector + texto en la base). Solo sirve para ordenar esa lista.
  score: number;
}

export type Fused = Retrieved & { fused: number; votes: number };

// Reciprocal Rank Fusion entre las listas de varias consultas: un fragmento que sale bien posicionado en VARIAS consultas
// sube; uno que solo aparece en una, baja. `k` amortigua la diferencia entre los primeros puestos.
export function fuseVariants(lists: Retrieved[][], k = 60): Fused[] {
  const acc = new Map<string, Fused>();
  for (const list of lists) {
    list.forEach((c, i) => {
      const add = 1 / (k + i + 1);
      const prev = acc.get(c.chunk_id);
      if (prev) {
        prev.fused += add;
        prev.votes += 1;
      } else {
        acc.set(c.chunk_id, { ...c, fused: add, votes: 1 });
      }
    });
  }
  return Array.from(acc.values()).sort((a, b) => b.fused - a.fused || a.chunk_index - b.chunk_index);
}

// Descarta lo claramente menos relevante que lo mejor, pero NUNCA deja menos de `minKeep` (mejor poco contexto flojo que
// ninguno). Con pocas consultas el RRF es plano: el corte actua sobre todo cuando hay muchas listas.
export function relativeCutoff<T extends { fused: number }>(sorted: T[], ratio = 0.25, minKeep = 4): T[] {
  if (sorted.length <= minKeep) return sorted;
  const top = sorted[0].fused;
  return sorted.filter((c, i) => i < minKeep || c.fused >= top * ratio);
}

function shingles(text: string, n = 5): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\sáéíóúüñ]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  if (words.length <= n) {
    if (words.length) out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i <= words.length - n; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

// Los fragmentos se solapan a proposito (para no cortar ideas) y los PDF repiten encabezados: dos fragmentos casi iguales
// gastan presupuesto sin aportar. Se conserva el mas relevante (el primero, porque la lista llega ordenada).
export function dropNearDuplicates<T extends { content: string }>(sorted: T[], threshold = 0.6): T[] {
  const kept: { item: T; sh: Set<string> }[] = [];
  for (const item of sorted) {
    const sh = shingles(item.content);
    const dup = kept.some((k) => {
      let inter = 0;
      sh.forEach((s) => k.sh.has(s) && inter++);
      const union = sh.size + k.sh.size - inter;
      return union > 0 && inter / union >= threshold;
    });
    if (!dup) kept.push({ item, sh });
  }
  return kept.map((k) => k.item);
}

// Elige por RELEVANCIA hasta llenar el presupuesto (un fragmento que no cabe se salta: puede caber uno mas corto despues)
// y devuelve los elegidos en ORDEN DE DOCUMENTO, que es como se lee un material.
export function packByRelevance<T extends { content: string; material_id: string; chunk_index: number }>(
  sorted: T[],
  charLimit: number,
  maxChunks = 8
): T[] {
  const chosen: T[] = [];
  let used = 0;
  for (const c of sorted) {
    if (chosen.length >= maxChunks) break;
    const cost = c.content.length + (chosen.length ? 2 : 0);
    if (chosen.length === 0 && c.content.length > charLimit) {
      // El primero ya excede el limite: se incluye truncado (mejor contexto cortado que ninguno), igual que antes.
      chosen.push({ ...c, content: c.content.slice(0, charLimit) });
      used = charLimit;
      continue;
    }
    if (used + cost > charLimit) continue;
    chosen.push(c);
    used += cost;
  }
  return chosen.sort((a, b) => (a.material_id === b.material_id ? a.chunk_index - b.chunk_index : a.material_id < b.material_id ? -1 : 1));
}

// Los parametros de la seleccion, juntos: los usa la recuperacion de produccion Y el barrido de hiperparametros (scripts/eval-rag-sweep.ts), asi lo que se mide es
// exactamente lo que corre.
export interface SelectOptions {
  // Constante k de la fusion RRF (mas alta = mas plano el aporte de los primeros puestos).
  k: number;
  // Un fragmento se descarta si su puntaje fusionado es menor que este porcentaje del mejor (0 = no corta nada); nunca quedan menos de `minKeep`.
  cutoffRatio: number;
  minKeep: number;
  charLimit: number;
  maxChunks: number;
  // Desde que parecido (Jaccard de grupos de 5 palabras) dos fragmentos se consideran repetidos.
  dupThreshold?: number;
}

export function selectContext(lists: Retrieved[][], o: SelectOptions): Fused[] {
  const fused = fuseVariants(lists, o.k);
  const kept = dropNearDuplicates(relativeCutoff(fused, o.cutoffRatio, o.minKeep), o.dupThreshold);
  return packByRelevance(kept, o.charLimit, o.maxChunks);
}

export function joinContext(chunks: { content: string }[]): string {
  return chunks.map((c) => c.content).join('\n\n');
}
