// Duplicados SEMANTICOS entre materiales: el mismo concepto con nombres distintos ("Aztecas" y "Aztecas/Mexicas", "Utilidad marginal" y "Utilidad Marginal (UM)", "Reino Nuevo" y
// "Imperio Nuevo"). La fusion por claves (merge.ts) solo une nombres casi identicos palabra por palabra; esto detecta pares que ese criterio no ve. Dos niveles de confianza:
//
//   ALTA  (alias): el nombre de uno aparece como ALIAS del otro: separados por "/" ("Aztecas/Mexicas") o el nombre sin lo que va entre parentesis ("Utilidad Marginal (UM)"). Es una
//         señal que el propio material escribio, no una suposicion; por eso se fusiona sola (conservando las fuentes {materialId, chunks} de ambos).
//   MEDIA (sinonimo): los nombres solo difieren en un sinonimo historico conocido (Reino/Imperio, Batalla/Combate...). NO se fusiona sola: "Reino Romano" (la monarquia) e "Imperio
//         Romano" son cosas distintas. Se devuelve como CANDIDATO (con la superposicion del vecindario en el grafo como pista) para que lo decida una persona o un paso asistido.
//
// Funciones puras, sin red. Complejidad: O(N·A) con indices por alias y por firma (nunca O(N²)).

import { normalizeKey } from './text';
import type { Concept, ConceptKind, Edge } from './types';

export type DuplicateConfidence = 'alta' | 'media';

export interface DuplicatePair {
  // Claves de los dos conceptos (a < b).
  a: string;
  b: string;
  confidence: DuplicateConfidence;
  reason: 'alias' | 'sinonimo' | 'contencion';
  // 0..1: 1 para un alias; para un sinonimo, 0.5 + media superposicion del vecindario.
  score: number;
}

// Tipos "blandos" que la IA confunde entre si (pueblo/persona/concepto): un alias entre ellos si es el mismo concepto.
const SOFT = new Set<ConceptKind>(['concepto', 'definicion', 'persona', 'grupo']);
const kindsCompatible = (a: ConceptKind, b: ConceptKind) => a === b || (SOFT.has(a) && SOFT.has(b));

const MIN_ALIAS_LEN = 4;
const MAX_OWNERS_PER_ALIAS = 6;

// Los alias de un nombre como claves normalizadas: cada parte separada por "/" o "|", sin lo que va entre parentesis, y el nombre completo. Ademas, la forma COMPACTA de cada una
// (sin guiones): "Ma'at" (ma-at) y "Maat" (maat) son el mismo nombre escrito con un apostrofe. Las siglas cortas ("UM") no cuentan: serian demasiado ambiguas.
export function aliasKeys(name: string): string[] {
  const out: string[] = [];
  const add = (k: string) => {
    if (k.length >= MIN_ALIAS_LEN && out.indexOf(k) === -1) out.push(k);
  };
  const base = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = base.split(/\s*[/|]\s*/).map(normalizeKey);
  parts.forEach(add);
  add(normalizeKey(name));
  parts.concat(normalizeKey(name)).forEach((k) => k.indexOf('-') !== -1 && add(k.replace(/-/g, '')));
  return out;
}

// Sinonimos historicos que solo se proponen como candidatos (confianza MEDIA). Cada clase lleva su palabra canonica primero.
const SYNONYM_CLASSES: string[][] = [
  ['reino', 'imperio'],
  ['batalla', 'combate'],
  ['guerra', 'conflicto'],
  ['ciudad', 'urbe'],
  ['rey', 'monarca'],
  ['dios', 'deidad'],
  ['templo', 'santuario'],
  ['tumba', 'sepulcro'],
  ['ley', 'norma'],
  ['escritura', 'grafia'],
];
const CANON: Record<string, string> = Object.create(null);
SYNONYM_CLASSES.forEach((cls) => cls.forEach((w) => (CANON[w] = cls[0])));

// Firma de un nombre: sus palabras con los sinonimos reemplazados por su palabra canonica, ordenadas. Devuelve si hubo reemplazo.
function signature(key: string): { sig: string; substituted: boolean } {
  let substituted = false;
  const toks = key.split('-').map((t) => {
    const c = CANON[t];
    if (c && c !== t) substituted = true;
    return c ?? t;
  });
  return { sig: toks.slice().sort().join('|'), substituted };
}

// Pares de CLAVES que se pueden fusionar con confianza ALTA (alias). Es lo unico que mergeGraphs aplica por su cuenta.
export function aliasUnions(concepts: Concept[]): [string, string][] {
  // Una entrada por clave (la misma clave puede venir de varios materiales con nombres algo distintos).
  const names: Record<string, string[]> = Object.create(null);
  const kinds: Record<string, ConceptKind[]> = Object.create(null);
  for (const c of concepts) {
    (names[c.key] = names[c.key] ?? []).push(c.name);
    (kinds[c.key] = kinds[c.key] ?? []).push(c.kind);
  }
  // alias -> claves que lo tienen.
  const owners: Record<string, string[]> = Object.create(null);
  Object.keys(names)
    .sort()
    .forEach((key) => {
      const seen: Record<string, true> = Object.create(null);
      names[key].forEach((n) => aliasKeys(n).forEach((a) => (seen[a] = true)));
      seen[key] = true;
      Object.keys(seen).forEach((a) => {
        const list = (owners[a] = owners[a] ?? []);
        if (list.indexOf(key) === -1) list.push(key);
      });
    });
  const pairs: [string, string][] = [];
  const done: Record<string, true> = Object.create(null);
  Object.keys(owners)
    .sort()
    .forEach((alias) => {
      const list = owners[alias].slice(0, MAX_OWNERS_PER_ALIAS);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const [x, y] = list[i] < list[j] ? [list[i], list[j]] : [list[j], list[i]];
          const id = x + '\u0000' + y;
          if (done[id]) continue;
          if (!kinds[x].some((kx) => kinds[y].some((ky) => kindsCompatible(kx, ky)))) continue;
          done[id] = true;
          pairs.push([x, y]);
        }
      }
    });
  return pairs;
}

// Palabras que, al sobrar, indican OTRA cosa y no un calificativo del mismo concepto: "Antiguo Egipto" no es "Imperio Antiguo de Egipto" (periodos distintos), "Segundo Periodo
// Intermedio" no es "Periodo Intermedio". En una contencion, si la palabra que sobra es de estas, no se propone.
const DISTINCTIVE = new Set(['imperio', 'reino', 'periodo', 'dinastia', 'epoca', 'era', 'edad', 'guerra', 'batalla', 'primer', 'primero', 'segundo', 'tercer', 'tercero', 'cuarto', 'quinto', 'nuevo', 'nueva', 'antiguo', 'antigua', 'medio', 'media', 'tardio', 'tardia', 'alto', 'bajo', 'gran', 'mayor', 'menor']);

// Jaccard de los vecindarios (claves vecinas por cualquier relacion) de dos conceptos.
function neighborOverlap(a: string, b: string, adj: Record<string, Record<string, true>>): number {
  const na = adj[a] ?? {};
  const nb = adj[b] ?? {};
  const ka = Object.keys(na).filter((k) => k !== b);
  const kb = Object.keys(nb).filter((k) => k !== a);
  if (ka.length === 0 || kb.length === 0) return 0;
  const inter = ka.filter((k) => nb[k]).length;
  return inter / (ka.length + kb.length - inter);
}

// Todos los candidatos del grafo, de mas a menos seguros. Los de confianza ALTA ya los fusiona mergeGraphs; los de MEDIA se devuelven para decidir.
export function findDuplicateCandidates(concepts: Concept[], edges: Edge[]): DuplicatePair[] {
  const byKey: Record<string, Concept> = Object.create(null);
  concepts.forEach((c) => (byKey[c.key] = c));
  const adj: Record<string, Record<string, true>> = Object.create(null);
  edges.forEach((e) => {
    (adj[e.from] = adj[e.from] ?? Object.create(null))[e.to] = true;
    (adj[e.to] = adj[e.to] ?? Object.create(null))[e.from] = true;
  });

  const out: DuplicatePair[] = [];
  const seen: Record<string, true> = Object.create(null);
  const push = (a: string, b: string, confidence: DuplicateConfidence, reason: DuplicatePair['reason'], score: number) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    const id = x + '\u0000' + y;
    if (seen[id] || x === y) return;
    seen[id] = true;
    out.push({ a: x, b: y, confidence, reason, score });
  };

  aliasUnions(concepts).forEach(([a, b]) => push(a, b, 'alta', 'alias', 1));

  // Sinonimos: se agrupa por firma; solo cuenta un grupo donde al menos uno uso un sinonimo.
  const groups: Record<string, { key: string; substituted: boolean }[]> = Object.create(null);
  Object.keys(byKey)
    .sort()
    .forEach((key) => {
      const s = signature(key);
      (groups[s.sig] = groups[s.sig] ?? []).push({ key, substituted: s.substituted });
    });
  Object.keys(groups).forEach((sig) => {
    const g = groups[sig];
    if (g.length < 2 || !g.some((m) => m.substituted)) return;
    for (let i = 0; i < g.length && i < MAX_OWNERS_PER_ALIAS; i++) {
      for (let j = i + 1; j < g.length && j < MAX_OWNERS_PER_ALIAS; j++) {
        if (g[i].key === g[j].key || !kindsCompatible(byKey[g[i].key].kind, byKey[g[j].key].kind)) continue;
        push(g[i].key, g[j].key, 'media', 'sinonimo', 0.5 + 0.5 * neighborOverlap(g[i].key, g[j].key, adj));
      }
    }
  });
  // Contencion de UNA palabra ("Senado" ~ "Senado Romano", "Imperio Nuevo" ~ "Imperio Nuevo de Egipto", "Nilo" ~ "Río Nilo"): el nombre corto es el nucleo del largo. Casi siempre es el
  // mismo concepto, pero puede ser otro ("Egipto" y "Egipto ptolemaico"), asi que solo se propone, con puntaje bajo que sube si comparten vecindario.
  const bySig: Record<string, string[]> = Object.create(null);
  Object.keys(byKey)
    .sort()
    .forEach((key) => {
      const sig = key.split('-').sort().join('|');
      (bySig[sig] = bySig[sig] ?? []).push(key);
    });
  Object.keys(byKey)
    .sort()
    .forEach((long) => {
      const toks = long.split('-');
      if (toks.length < 2) return;
      for (let drop = 0; drop < toks.length; drop++) {
        if (DISTINCTIVE.has(toks[drop])) continue;
        const sig = toks.filter((_, i) => i !== drop).sort().join('|');
        for (const short of bySig[sig] ?? []) {
          if (short.length < MIN_ALIAS_LEN || short === long || !kindsCompatible(byKey[short].kind, byKey[long].kind)) continue;
          push(short, long, 'media', 'contencion', 0.4 + 0.6 * neighborOverlap(short, long, adj));
        }
      }
    });
  return out.sort((p, q) => (p.confidence === q.confidence ? q.score - p.score : p.confidence === 'alta' ? -1 : 1) || (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : 1));
}
