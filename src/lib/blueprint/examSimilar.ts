// ¿Esta pregunta nueva es casi la misma que una que ya existe? El banco solo impide el MISMO enunciado exacto (indice unico por md5); medido con material real, al generar otra vez salio
// «¿Qué representa la elasticidad precio de la demanda?» junto a la ya aprobada «¿Qué mide la elasticidad precio de la demanda?», con la misma cita. Codigo puro.
//
// Parecido = Jaccard de las palabras con contenido (3 letras o mas, sin tildes). Dos reglas, para no frenar preguntas distintas sobre el mismo tema:
//   - parecido alto (SIMILAR.any) en cualquier caso: es la misma pregunta con otras palabras;
//   - parecido medio (SIMILAR.sameSource) si ademas son del mismo tipo y se apoyan en la misma cita: dos preguntas del mismo tipo sobre la misma frase miden lo mismo.

import { comparable } from './examQuestion';

export const SIMILAR = { any: 0.75, sameSource: 0.5 } as const;

export interface SimilarityRef {
  q: string;
  type: string;
  quote: string;
}

const words = (s: string): Set<string> => new Set(comparable(s).split(' ').filter((w) => w.length >= 3));

export function jaccard(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

// Devuelve la pregunta existente a la que se parece, o null.
export function findSimilar(candidate: SimilarityRef, others: readonly SimilarityRef[]): SimilarityRef | null {
  const quote = comparable(candidate.quote);
  for (const o of others) {
    const j = jaccard(candidate.q, o.q);
    if (j >= SIMILAR.any) return o;
    if (j >= SIMILAR.sameSource && o.type === candidate.type && comparable(o.quote) === quote) return o;
  }
  return null;
}
