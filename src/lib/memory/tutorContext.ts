// Contexto ANCLADO para el tutor o el generador de explicaciones. En vez de pasarle toda la memoria (o nada, y que invente), se le da solo lo que importa para UNA pregunta: el
// concepto consultado, TODO lo que hay que saber antes (cierre transitivo de prerrequisitos, en orden de estudio: lo basico primero, por el orden topologico de Kahn de graph.ts) y
// las formulas LITERALES de los materiales. Si el concepto no esta en los materiales se dice, y el tutor no debe inventarlo. Es una funcion pura, sin red ni IA.
//
// El contenido viene de los materiales (de segunda mano, a traves de la memoria): al renderizarlo como texto para un prompt va como DATO entre delimitadores. Quien lo use puede pasar
// su propio `sanitize` (por ejemplo sanitizeForPrompt de src/lib/security) y siempre se neutralizan los delimitadores aqui mismo.

import { buildIndex, prerequisitesOf, searchConcepts } from './graph';
import { COVER_THRESHOLD } from './sufficiency';
import { KIND_LABEL, type Concept, type Graph } from './types';

export interface TutorCard {
  key: string;
  name: string;
  kind: string;
  definition: string;
  formula: string;
  unit: string;
}

export interface TutorContext {
  query: string;
  // false: la consulta no corresponde a nada de los materiales (el tutor debe decirlo y no inventar).
  found: boolean;
  concept: TutorCard | null;
  // Todo lo que hay que saber antes, en orden de estudio (lo mas basico primero). Recortado si hay demasiado.
  prerequisites: TutorCard[];
  // Prerrequisitos que se dejaron fuera por el tope.
  omitted: number;
  // Las formulas literales del concepto y de sus prerrequisitos (solo las que traen los materiales).
  formulas: { name: string; formula: string }[];
  // Prerrequisitos nombrados pero que los materiales no explican: el tutor debe decir que faltan, no explicarlos de memoria.
  unexplained: string[];
}

export const TUTOR_LIMITS = {
  prerequisites: 12,
  definitionChars: 320,
  formulaChars: 200,
  maxChars: 4000,
} as const;

const card = (c: Concept): TutorCard => ({
  key: c.key,
  name: c.name,
  kind: KIND_LABEL[c.kind] ?? c.kind,
  definition: c.definition.slice(0, TUTOR_LIMITS.definitionChars),
  formula: c.formula.slice(0, TUTOR_LIMITS.formulaChars),
  unit: c.unit,
});

export function buildTutorContext(graph: Graph, query: string, opts: { maxPrerequisites?: number } = {}): TutorContext {
  const empty: TutorContext = { query, found: false, concept: null, prerequisites: [], omitted: 0, formulas: [], unexplained: [] };
  if (typeof query !== 'string' || query.trim().length === 0 || graph.concepts.length === 0) return empty;
  const index = buildIndex(graph.concepts);
  const hit = searchConcepts(index, query, 1)[0];
  if (!hit || hit.score < COVER_THRESHOLD) return empty;
  const byKey: Record<string, Concept> = Object.create(null);
  graph.concepts.forEach((c) => (byKey[c.key] = c));
  const root = byKey[hit.key];
  if (!root) return empty;

  const max = Math.max(0, opts.maxPrerequisites ?? TUTOR_LIMITS.prerequisites);
  const all = prerequisitesOf(graph, root.key).map((k) => byKey[k]).filter((c): c is Concept => !!c);
  const kept = all.slice(0, max);
  const formulas: { name: string; formula: string }[] = [];
  kept.concat([root]).forEach((c) => c.formula && formulas.push({ name: c.name, formula: c.formula.slice(0, TUTOR_LIMITS.formulaChars) }));
  return {
    query,
    found: true,
    concept: card(root),
    prerequisites: kept.map(card),
    omitted: all.length - kept.length,
    formulas,
    unexplained: kept.filter((c) => !c.definition && !c.formula).map((c) => c.name),
  };
}

// Texto plano de una linea y sin forma de cerrar el delimitador (ninguna racha de dos o mas "<" o ">").
function plain(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[<>＜＞]{2,}/g, (run) => run.split('').join(' ')).trim();
}

function line(c: TutorCard, clean: (s: string) => string): string {
  const parts = [clean(c.name) + ` [${c.kind}]`];
  if (c.definition) parts.push(clean(c.definition));
  if (c.formula) parts.push(`Fórmula de los apuntes: ${clean(c.formula)}`);
  if (c.unit) parts.push(`Unidad: ${clean(c.unit)}`);
  return parts.join(' — ');
}

// El bloque para el prompt del tutor. '' si no hay nada que anclar.
export function renderTutorContext(ctx: TutorContext, opts: { sanitize?: (s: string) => string; maxChars?: number } = {}): string {
  const clean = (s: string) => plain(opts.sanitize ? opts.sanitize(s) : s);
  if (!ctx.found || !ctx.concept) {
    return `<<<CONTEXTO\nLo que se preguntó («${clean(ctx.query).slice(0, 100)}») NO aparece en los materiales de la clase. No lo expliques de memoria: dile al estudiante que ese tema no está en sus materiales.\nCONTEXTO>>>`;
  }
  const lines: string[] = [`Concepto consultado: ${line(ctx.concept, clean)}`];
  if (ctx.prerequisites.length > 0) {
    lines.push('Antes de entenderlo hace falta saber (en este orden):');
    ctx.prerequisites.forEach((p, i) => lines.push(`${i + 1}. ${line(p, clean)}`));
    if (ctx.omitted > 0) lines.push(`(Hay ${ctx.omitted} prerrequisito(s) más que no se incluyen.)`);
  } else {
    lines.push('No se registran prerrequisitos para este concepto en los materiales.');
  }
  if (ctx.unexplained.length > 0) lines.push(`Los materiales nombran pero NO explican: ${ctx.unexplained.map(clean).join('; ')}. Dilo; no los expliques de memoria.`);
  let body = lines.join('\n');
  const cap = opts.maxChars ?? TUTOR_LIMITS.maxChars;
  if (body.length > cap) body = body.slice(0, cap);
  return `<<<CONTEXTO\n${body}\nCONTEXTO>>>`;
}
