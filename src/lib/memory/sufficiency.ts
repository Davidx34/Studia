// "¿Alcanza lo que la clase sabe para crear esto?" Antes de generar un laboratorio, un objetivo o una explicacion, se comparan los conceptos que HACEN FALTA con la memoria de la
// clase. Si faltan los esenciales, se dice cual y no se inventa nada a medias. Sin red: los requisitos los propone la IA (o el codigo) y aqui solo se miden.

import { buildIndex, prerequisitesOf, searchConcepts } from './graph';
import { dice, normalizeKey } from './text';
import type { Concept, Graph } from './types';

export interface Requirement {
  // Lo que hace falta saber ("restriccion presupuestal", "utilidad marginal").
  term: string;
  // Sin esto no se puede crear lo pedido (si no, es deseable).
  essential: boolean;
  // Si hace falta ademas la formula (para simular, necesitamos la ecuacion).
  needsFormula?: boolean;
}

export type CoverageNote = 'ok' | 'no-encontrado' | 'sin-definicion' | 'sin-formula';

export interface CoverageItem {
  term: string;
  essential: boolean;
  covered: boolean;
  note: CoverageNote;
  // El concepto de la memoria que lo cubre (si hay).
  key: string | null;
  name: string | null;
  score: number;
}

export type Verdict = 'sufficient' | 'partial' | 'insufficient';

export interface Coverage {
  verdict: Verdict;
  // Fraccion de requisitos cubiertos, ponderando los esenciales el doble.
  ratio: number;
  items: CoverageItem[];
  // Lo esencial que no esta (o esta sin lo que hace falta), en palabras para el profesor.
  missing: string[];
  // Lo que esta pero flojo: sin definicion, o prerrequisitos sin explicar.
  weak: string[];
}

export const COVER_THRESHOLD = 0.6;

const NOTE_TEXT: Record<Exclude<CoverageNote, 'ok'>, string> = {
  'no-encontrado': 'no aparece en los materiales',
  'sin-definicion': 'aparece pero sin una definición',
  'sin-formula': 'aparece pero sin su fórmula',
};

function best(concepts: Concept[], index: ReturnType<typeof buildIndex>, term: string): { concept: Concept; score: number } | null {
  const byKey: Record<string, Concept> = {};
  concepts.forEach((c) => {
    byKey[c.key] = c;
  });
  const hits = searchConcepts(index, term, 3);
  let top: { concept: Concept; score: number } | null = null;
  for (const h of hits) if (!top || h.score > top.score) top = { concept: byKey[h.key], score: h.score };
  // Respaldo: nombres casi iguales que la busqueda por palabras no junto (otra raiz, una letra distinta).
  const k = normalizeKey(term);
  for (const c of concepts) {
    const d = dice(k, c.key);
    if (d >= 0.8 && (!top || d > top.score)) top = { concept: c, score: d };
  }
  return top;
}

// ¿El concepto trae su ecuacion? En su campo, o escrita dentro de la definicion ("... es p*x + q*y = M").
function hasFormula(c: Concept): boolean {
  return !!c.formula || /[A-Za-z0-9)]\s*=\s*[A-Za-z0-9(]/.test(c.definition);
}

export function assessCoverage(requirements: Requirement[], graph: Graph): Coverage {
  const index = buildIndex(graph.concepts);
  const items: CoverageItem[] = requirements.map((r) => {
    const hit = graph.concepts.length > 0 ? best(graph.concepts, index, r.term) : null;
    if (!hit || hit.score < COVER_THRESHOLD) {
      return { term: r.term, essential: r.essential, covered: false, note: 'no-encontrado', key: null, name: null, score: hit?.score ?? 0 };
    }
    const c = hit.concept;
    const note: CoverageNote = r.needsFormula && !hasFormula(c) ? 'sin-formula' : !c.definition && !c.formula ? 'sin-definicion' : 'ok';
    return { term: r.term, essential: r.essential, covered: note === 'ok', note, key: c.key, name: c.name, score: hit.score };
  });

  const weight = (i: CoverageItem) => (i.essential ? 2 : 1);
  const total = items.reduce((s, i) => s + weight(i), 0);
  const ratio = total === 0 ? 0 : items.reduce((s, i) => s + (i.covered ? weight(i) : 0), 0) / total;
  const essentials = items.filter((i) => i.essential);
  const essentialCovered = essentials.filter((i) => i.covered).length;

  const missing = items.filter((i) => i.essential && !i.covered).map((i) => `«${i.term}»: ${NOTE_TEXT[i.note as Exclude<CoverageNote, 'ok'>]}`);
  const weak = items.filter((i) => !i.essential && !i.covered).map((i) => `«${i.term}»: ${NOTE_TEXT[i.note as Exclude<CoverageNote, 'ok'>]}`);

  // Prerrequisitos de lo cubierto que la clase nombra pero no explica.
  const byKey: Record<string, Concept> = {};
  graph.concepts.forEach((c) => {
    byKey[c.key] = c;
  });
  const seen: Record<string, true> = {};
  for (const i of items) {
    if (!i.covered || !i.key) continue;
    for (const p of prerequisitesOf(graph, i.key)) {
      const pc = byKey[p];
      if (pc && !pc.definition && !pc.formula && !seen[p]) {
        seen[p] = true;
        weak.push(`«${pc.name}» (prerrequisito de «${i.name}»): se nombra pero no se explica`);
      }
    }
  }

  // Un concepto esencial que NO esta en los materiales no se puede suplir: es "insuficiente" (nada a medias). "Parcial" es cuando todo lo esencial aparece pero algo esta flojo
  // (sin definicion o sin su formula) o falta bastante de lo deseable: el profesor decide si sigue.
  const notFound = items.some((i) => i.essential && i.note === 'no-encontrado');
  let verdict: Verdict;
  if (requirements.length === 0 || notFound) verdict = 'insufficient';
  else if (essentialCovered === essentials.length && ratio >= 0.75) verdict = 'sufficient';
  else verdict = ratio >= 0.5 ? 'partial' : 'insufficient';

  return { verdict, ratio, items, missing, weak };
}

// Una explicacion para el profesor, en palabras.
export function explainCoverage(c: Coverage): string {
  if (c.verdict === 'sufficient') return 'Los materiales de la clase tienen lo necesario para crear esto.';
  const head =
    c.verdict === 'partial'
      ? 'Los materiales cubren parte de lo necesario, pero faltan cosas importantes'
      : 'Los materiales cargados todavía no alcanzan para crear esto';
  const list = c.missing.length > 0 ? `: ${c.missing.join('; ')}.` : '.';
  return `${head}${list} Sube un material que lo explique y vuelve a intentarlo.`;
}
