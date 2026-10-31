import { extractMaterial, type ModelCaller } from '@/lib/memory/extract';
import { dice, normalizeKey } from '@/lib/memory/text';
import type { Graph, Profile } from '@/lib/memory/types';
import { evaluateGates, ratio, round3, type EvalReport, type Gate } from './common';

// Evaluador de la MEMORIA DE CLASE contra un conjunto dorado: ¿los conceptos que sale a leer son los que el texto explica (y no otros)?, ¿detecta bien si la
// materia es cuantitativa o narrativa?, ¿marca "causa" solo donde el texto la expresa?
//
// El "generador" bajo prueba es el modelo (ModelCaller) y la tuberia de extraccion (extractMaterial): un caso se lee con el modelo, y se mide lo que SALE de la
// tuberia (ya filtrado por el anclaje al texto y por la exigencia de una expresion causal). Ambos se inyectan: asi las pruebas pueden poner un modelo defectuoso o una
// tuberia defectuosa y comprobar que el evaluador lo detecta.

export interface MemoryGoldenCase {
  id: string;
  // 'sintetico' va en el repositorio. 'real' sale de materiales de una clase y se carga desde un archivo local que NO se versiona (el repositorio es publico).
  origin: 'sintetico' | 'real';
  profile: Profile;
  text: string;
  // Conceptos que un buen mapa DEBE tener.
  expectedConcepts: string[];
  // Otros conceptos legitimos: no suman al recall pero tampoco restan a la precision.
  acceptableConcepts?: string[];
  // Pares [causa, efecto] que el texto expresa como causales.
  causalEdges: [string, string][];
  // Pares que el texto menciona juntos SIN presentarlos como causa: marcarlos "causa" es un falso positivo.
  notCausal: [string, string][];
  // Pares trampa que la tuberia actual NO puede descartar (limite conocido): se miden y se informan, pero no frenan la compuerta.
  knownGapNotCausal?: [string, string][];
}

export type MemoryGenerator = (c: MemoryGoldenCase) => ModelCaller;
export type ExtractFn = typeof extractMaterial;

export const MEMORY_GATES: Gate[] = [
  { metric: 'nodePrecision', op: '>=', threshold: 0.8, why: 'los conceptos que la memoria guarda deben ser los que el texto explica' },
  { metric: 'nodeRecall', op: '>=', threshold: 0.7, why: 'la memoria no puede dejar fuera lo central del texto' },
  { metric: 'profileAccuracy', op: '>=', threshold: 1, why: 'el perfil (cuantitativo/narrativo) decide el vocabulario con que se lee todo el material' },
  { metric: 'causaFalsePositiveRate', op: '<=', threshold: 0.2, why: 'una arista "causa" falsa le ensenia al estudiante algo que el texto no dice' },
  { metric: 'trapCausaRate', op: '<=', threshold: 0.1, why: 'un par mencionado sin expresion causal no debe quedar como causa' },
  { metric: 'causalRecall', op: '>=', threshold: 0.5, why: 'las causas que el texto si expresa no deben perderse' },
];

const same = (a: string, b: string): boolean => {
  const ka = normalizeKey(a);
  const kb = normalizeKey(b);
  return ka === kb || dice(ka, kb) >= 0.8;
};

const matchesAny = (name: string, list: string[]): boolean => list.some((x) => same(name, x));

function nameOf(graph: Graph, key: string): string {
  return graph.concepts.find((c) => c.key === key)?.name ?? key;
}

export async function runMemoryEval(cases: MemoryGoldenCase[], generator: MemoryGenerator, deps: { extract?: ExtractFn } = {}): Promise<EvalReport> {
  const extract = deps.extract ?? extractMaterial;
  const details: string[] = [];
  let predicted = 0;
  let predictedOk = 0;
  let expected = 0;
  let expectedFound = 0;
  let profileOk = 0;
  let causaPredicted = 0;
  let causaWrong = 0;
  let causalExpected = 0;
  let causalFound = 0;
  let traps = 0;
  let trapsCausa = 0;
  let gapTraps = 0;
  let gapTrapsCausa = 0;

  for (const c of cases) {
    const chunks = c.text.split(/\n{2,}/).map((content, chunk_index) => ({ chunk_index, content }));
    const r = await extract(chunks, `golden-${c.id}`, c.id, generator(c));
    const graph = r.extraction;
    const names = graph.concepts.map((x) => x.name);
    const allowed = [...c.expectedConcepts, ...(c.acceptableConcepts ?? [])];

    predicted += names.length;
    predictedOk += names.filter((n) => matchesAny(n, allowed)).length;
    expected += c.expectedConcepts.length;
    const found = c.expectedConcepts.filter((e) => matchesAny(e, names));
    expectedFound += found.length;
    if (r.profile === c.profile) profileOk++;
    else details.push(`${c.id}: perfil ${r.profile}, se esperaba ${c.profile}`);
    const missing = c.expectedConcepts.filter((e) => !matchesAny(e, names));
    if (missing.length) details.push(`${c.id}: faltan ${missing.join(', ')}`);
    const extra = names.filter((n) => !matchesAny(n, allowed));
    if (extra.length) details.push(`${c.id}: sobran ${extra.join(', ')}`);

    const causa = graph.edges.filter((e) => e.relation === 'causa').map((e) => ({ from: nameOf(graph, e.from), to: nameOf(graph, e.to) }));
    const isExpected = (e: { from: string; to: string }) => c.causalEdges.some(([a, b]) => same(e.from, a) && same(e.to, b));
    // Una causa en un par de `knownGapNotCausal` es un fallo conocido de la tuberia: se mide aparte (knownGapTrapCausaRate) y no entra en esta compuerta, que mide lo CORREGIBLE.
    const isKnownGap = (e: { from: string; to: string }) => (c.knownGapNotCausal ?? []).some(([a, b]) => (same(e.from, a) && same(e.to, b)) || (same(e.from, b) && same(e.to, a)));
    const gated = causa.filter((e) => !isKnownGap(e));
    causaPredicted += gated.length;
    const wrong = gated.filter((e) => !isExpected(e));
    causaWrong += wrong.length;
    wrong.forEach((e) => details.push(`${c.id}: causa falsa ${e.from} -> ${e.to}`));
    causalExpected += c.causalEdges.length;
    causalFound += c.causalEdges.filter(([a, b]) => causa.some((e) => same(e.from, a) && same(e.to, b))).length;

    const between = (p: [string, string]) => causa.some((e) => (same(e.from, p[0]) && same(e.to, p[1])) || (same(e.from, p[1]) && same(e.to, p[0])));
    traps += c.notCausal.length;
    c.notCausal.forEach((p) => {
      if (between(p)) {
        trapsCausa++;
        details.push(`${c.id}: par sin causa marcado como causa: ${p[0]} / ${p[1]}`);
      }
    });
    (c.knownGapNotCausal ?? []).forEach((p) => {
      gapTraps++;
      if (between(p)) {
        gapTrapsCausa++;
        details.push(`${c.id}: [limite conocido] par sin causa marcado como causa: ${p[0]} / ${p[1]}`);
      }
    });
  }

  const metrics = {
    // Sin conceptos predichos no hay precision que medir: se toma 0 (falla cerrado), no 1.
    nodePrecision: round3(ratio(predictedOk, predicted, 0)),
    nodeRecall: round3(ratio(expectedFound, expected, 0)),
    profileAccuracy: round3(ratio(profileOk, cases.length, 0)),
    causaFalsePositiveRate: round3(ratio(causaWrong, causaPredicted, 0)),
    trapCausaRate: round3(ratio(trapsCausa, traps, 0)),
    causalRecall: round3(ratio(causalFound, causalExpected, 1)),
    // Informativa (sin compuerta): trampas que la tuberia actual no sabe descartar.
    knownGapTrapCausaRate: round3(ratio(gapTrapsCausa, gapTraps, 0)),
  };
  return evaluateGates('eval:memory', cases.length, metrics, MEMORY_GATES, details);
}

// ───────────────────────────── casos reales desde un archivo local ─────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim().length > 0) ? (v as string[]) : null);
const pairList = (v: unknown): [string, string][] | null => {
  if (!Array.isArray(v)) return null;
  const out: [string, string][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || !p[0].trim() || !p[1].trim()) return null;
    out.push([p[0], p[1]]);
  }
  return out;
};

// Valida un JSON local con casos REALES (materiales de una clase, que no se versionan). Lanza con el motivo exacto: un caso mal formado dejaria una medicion sin sentido.
export function parseMemoryCases(raw: unknown): MemoryGoldenCase[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('El archivo de casos debe ser una lista con al menos un caso.');
  const ids = new Set<string>();
  return raw.map((r, i) => {
    const where = `caso ${i + 1}`;
    if (!isObj(r)) throw new Error(`${where}: debe ser un objeto.`);
    if (typeof r.id !== 'string' || !r.id.trim()) throw new Error(`${where}: falta "id".`);
    if (ids.has(r.id)) throw new Error(`${where}: el id "${r.id}" esta repetido.`);
    ids.add(r.id);
    if (r.profile !== 'cuantitativo' && r.profile !== 'narrativo') throw new Error(`${where}: "profile" debe ser "cuantitativo" o "narrativo".`);
    if (typeof r.text !== 'string' || r.text.trim().length < 50) throw new Error(`${where}: "text" debe tener al menos 50 caracteres.`);
    const expected = strList(r.expectedConcepts);
    if (!expected || expected.length === 0) throw new Error(`${where}: "expectedConcepts" debe ser una lista de textos no vacia.`);
    const acceptable = r.acceptableConcepts === undefined ? [] : strList(r.acceptableConcepts);
    if (!acceptable) throw new Error(`${where}: "acceptableConcepts" debe ser una lista de textos.`);
    const causal = pairList(r.causalEdges ?? []);
    const notCausal = pairList(r.notCausal ?? []);
    const gap = pairList(r.knownGapNotCausal ?? []);
    if (!causal || !notCausal || !gap) throw new Error(`${where}: los pares ("causalEdges", "notCausal", "knownGapNotCausal") deben ser listas de [texto, texto].`);
    return { id: r.id, origin: 'real' as const, profile: r.profile, text: r.text, expectedConcepts: expected, acceptableConcepts: acceptable, causalEdges: causal, notCausal, knownGapNotCausal: gap };
  });
}
