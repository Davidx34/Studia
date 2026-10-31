import { selectContext, type Retrieved } from './fusion';
import { fold } from '@/lib/memory/text';

// Barrido de hiperparametros de la recuperacion (RAG). Piezas PURAS (sin red ni base): reciben las listas de candidatos que la busqueda hibrida YA devolvio para cada
// consulta de cada modulo y evaluan configuraciones (peso del texto, constante k del RRF, corte relativo) sobre ellas. El script scripts/eval-rag-sweep.ts consigue las
// listas de la base; aqui solo se mide y se compara.
//
// LA METRICA ES UN SUSTITUTO. No hay una verdad conocida de "el contexto correcto para este modulo" (eso lo mide eval:retrieval con preguntas generadas). Aqui se
// optimiza una combinacion de tres propiedades que SI se pueden medir sin etiquetas:
//   - diversidad entre modulos: modulos distintos no deben recibir el mismo contexto (el fallo medido el 2026-09-13: 8 modulos con el mismo contexto de 3 706 caracteres);
//   - cobertura del documento: que entre todos los modulos se use una buena parte del material, no siempre el mismo trozo;
//   - precision de conceptos clave: que los fragmentos elegidos hablen de los conceptos clave del modulo.
// Los conceptos clave salen de `topic_keywords` del modulo, que genera la propia tuberia: la metrica no es independiente del sistema. Por eso se recomienda un cambio solo si la
// mejora es clara y ninguna propiedad empeora de forma notable (ver `recommend`).

export interface ModuleRun {
  moduleId: string;
  // Palabras clave del modulo (sus conceptos clave).
  keywords: string[];
  // Candidatos por consulta, tal como los devolvio la busqueda hibrida para UN peso del texto.
  lists: Retrieved[][];
  // Fragmentos que tiene el material al que se acota el modulo (para medir cobertura).
  scopeChunks: number;
}

export interface TuningConfig {
  textWeight: number;
  k: number;
  cutoffRatio: number;
}

export interface TuningMetrics {
  diversity: number;
  coverage: number;
  conceptPrecision: number;
  // Informativa (no entra en el compuesto): fraccion de conceptos clave presentes en el contexto.
  conceptRecall: number;
  identicalPairs: number;
  composite: number;
}

export const COMPOSITE_WEIGHTS = { diversity: 0.4, coverage: 0.3, conceptPrecision: 0.3 } as const;

export const DEFAULT_GRID = {
  textWeights: [0, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2],
  ks: [10, 30, 60, 100],
  cutoffRatios: [0, 0.1, 0.25, 0.4],
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  a.forEach((x) => b.has(x) && inter++);
  return inter / (a.size + b.size - inter);
};

// 1 - parecido medio entre los contextos (Jaccard de fragmentos) de cada par de modulos. Contextos identicos (Jaccard 1) hunden la medida. Con un solo modulo no hay pares: 1.
export function interModuleDiversity(contexts: string[][]): { diversity: number; identicalPairs: number } {
  const sets = contexts.map((c) => new Set(c));
  let sum = 0;
  let pairs = 0;
  let identical = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const s = jaccard(sets[i], sets[j]);
      sum += s;
      pairs++;
      if (s === 1) identical++;
    }
  }
  return { diversity: pairs === 0 ? 1 : 1 - sum / pairs, identicalPairs: identical };
}

// Fraccion del material cubierta por la union de los fragmentos elegidos (tope 1).
export function documentCoverage(contexts: string[][], totalChunks: number): number {
  if (totalChunks <= 0) return 0;
  const union = new Set<string>();
  contexts.forEach((c) => c.forEach((id) => union.add(id)));
  return Math.min(1, union.size / totalChunks);
}

const hasTerm = (haystack: string, term: string): boolean => {
  const t = fold(term).trim();
  if (t.length < 2) return false;
  const re = new RegExp('(^|[^a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
  return re.test(haystack);
};

// De los fragmentos elegidos, cuantos mencionan al menos un concepto clave (precision) y cuantos conceptos clave aparecen en el contexto (recall).
export function conceptScores(chunks: { content: string }[], keywords: string[]): { precision: number; recall: number } {
  const kws = keywords.map((k) => k.trim()).filter((k) => k.length >= 2);
  if (kws.length === 0 || chunks.length === 0) return { precision: 0, recall: 0 };
  const texts = chunks.map((c) => fold(c.content));
  const precise = texts.filter((t) => kws.some((k) => hasTerm(t, k))).length;
  const all = texts.join(' ');
  const found = kws.filter((k) => hasTerm(all, k)).length;
  return { precision: precise / chunks.length, recall: found / kws.length };
}

export const composite = (m: Pick<TuningMetrics, 'diversity' | 'coverage' | 'conceptPrecision'>): number =>
  COMPOSITE_WEIGHTS.diversity * m.diversity + COMPOSITE_WEIGHTS.coverage * m.coverage + COMPOSITE_WEIGHTS.conceptPrecision * m.conceptPrecision;

export interface SelectLimits {
  charLimit: number;
  maxChunks: number;
}

export function evaluateConfig(runs: ModuleRun[], cfg: Pick<TuningConfig, 'k' | 'cutoffRatio'>, limits: SelectLimits): TuningMetrics {
  const contexts: string[][] = [];
  let precision = 0;
  let recall = 0;
  let scoped = 0;
  for (const run of runs) {
    const chosen = selectContext(run.lists, { k: cfg.k, cutoffRatio: cfg.cutoffRatio, minKeep: 4, charLimit: limits.charLimit, maxChunks: limits.maxChunks });
    contexts.push(chosen.map((c) => c.chunk_id));
    const s = conceptScores(chosen, run.keywords);
    precision += s.precision;
    recall += s.recall;
    scoped = Math.max(scoped, run.scopeChunks);
  }
  const n = Math.max(runs.length, 1);
  const { diversity, identicalPairs } = interModuleDiversity(contexts);
  const m = { diversity, coverage: documentCoverage(contexts, scoped), conceptPrecision: precision / n };
  return { ...m, conceptRecall: recall / n, identicalPairs, composite: composite(m) };
}

export interface SweepRow extends TuningConfig {
  metrics: TuningMetrics;
}

// runsByWeight: para cada peso del texto, las listas que la base devolvio con ese peso. k y corte se evaluan sin volver a buscar.
export function sweep(runsByWeight: Map<number, ModuleRun[]>, limits: SelectLimits, grid: Partial<typeof DEFAULT_GRID> = {}): SweepRow[] {
  const g = { ...DEFAULT_GRID, ...grid };
  const rows: SweepRow[] = [];
  runsByWeight.forEach((runs, textWeight) => {
    if (!g.textWeights.includes(textWeight)) return;
    for (const k of g.ks) {
      for (const cutoffRatio of g.cutoffRatios) rows.push({ textWeight, k, cutoffRatio, metrics: evaluateConfig(runs, { k, cutoffRatio }, limits) });
    }
  });
  // Desempate estable y explicable: mas diversidad, luego mas precision, y por ultimo lo mas cercano a la configuracion por defecto.
  return rows.sort((a, b) => b.metrics.composite - a.metrics.composite || b.metrics.diversity - a.metrics.diversity || b.metrics.conceptPrecision - a.metrics.conceptPrecision);
}

export interface Recommendation {
  change: boolean;
  best: SweepRow;
  baseline: SweepRow | null;
  reason: string;
}

export const RECOMMEND_MIN_GAIN = 0.02;
export const RECOMMEND_MAX_REGRESSION = 0.05;

// Recomienda cambiar los valores por defecto SOLO si: (1) se midio la configuracion actual, (2) la mejor mejora el compuesto al menos RECOMMEND_MIN_GAIN, y (3) ninguna de las
// tres propiedades empeora mas de RECOMMEND_MAX_REGRESSION (una mejora que se compra empeorando algo grave no cuenta).
export function recommend(rows: SweepRow[], current: TuningConfig): Recommendation | null {
  if (rows.length === 0) return null;
  const best = rows[0];
  const baseline = rows.find((r) => r.textWeight === current.textWeight && r.k === current.k && r.cutoffRatio === current.cutoffRatio) ?? null;
  if (!baseline) return { change: false, best, baseline, reason: 'La configuracion actual no esta en la rejilla medida: no hay con que compararla.' };
  const gain = best.metrics.composite - baseline.metrics.composite;
  if (gain < RECOMMEND_MIN_GAIN) return { change: false, best, baseline, reason: `La mejor configuracion mejora solo ${gain.toFixed(3)} (< ${RECOMMEND_MIN_GAIN}): no hay evidencia para cambiar.` };
  const worse = (['diversity', 'coverage', 'conceptPrecision'] as const).filter((k) => baseline.metrics[k] - best.metrics[k] > RECOMMEND_MAX_REGRESSION);
  if (worse.length > 0) return { change: false, best, baseline, reason: `Mejora ${gain.toFixed(3)} pero empeora ${worse.join(', ')} por mas de ${RECOMMEND_MAX_REGRESSION}: no se recomienda.` };
  return { change: true, best, baseline, reason: `Mejora el compuesto en ${gain.toFixed(3)} sin empeorar ninguna propiedad por mas de ${RECOMMEND_MAX_REGRESSION}.` };
}
