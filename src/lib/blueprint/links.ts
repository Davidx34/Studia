// Enlace entre los modulos del PLAN (ids de papel) y los modulos REALES de la clase (content_modules). Codigo puro: sin base de datos ni IA.
//
// Un enlace es { nodeId, moduleId }: el modulo del plan <-> un modulo real de la misma clase, 1 a 1. Sin enlace, el modulo del plan esta "pendiente de contenido". Las SUGERENCIAS se
// calculan por parecido de titulo y solo son eso: nunca se guardan solas, el profesor las acepta (docs/PLAN_POR_CORTES.md).

import { normalizeText } from './parse';
import type { Blueprint } from './types';

export interface PlanModule {
  nodeId: string;
  title: string;
  periodId: string;
  periodName: string;
  objectiveTitle: string;
}
export interface RealModule {
  id: string;
  title: string;
}
export interface Link {
  nodeId: string;
  moduleId: string;
}
export interface Suggestion extends Link {
  score: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_LINKS = 12 * 12 * 12; // un modulo por nodo: 12 cortes x 12 objetivos x 12 modulos

// Todos los modulos del plan, en orden de recorrido (corte, objetivo, modulo).
export function planModules(bp: Blueprint): PlanModule[] {
  const out: PlanModule[] = [];
  for (const p of bp.periods) for (const ob of p.objectives) for (const m of ob.modules) out.push({ nodeId: m.id, title: m.title, periodId: p.id, periodName: p.name, objectiveTitle: ob.title });
  return out;
}

// Palabras que no distinguen un titulo de otro.
const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'y', 'e', 'o', 'en', 'a', 'al', 'con', 'para', 'por', 'sobre', 'que', 'se', 'su', 'sus', 'introduccion', 'modulo', 'leccion', 'tema', 'unidad']);

export function tokens(title: string): string[] {
  const t = normalizeText(title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return Array.from(new Set(t.split(' ').filter((w) => w.length > 0 && !STOP.has(w))));
}

// Parecido de dos titulos, de 0 a 1: la parte que comparten sobre lo que suman (Jaccard). Dos titulos sin palabras utiles (solo palabras vacias) no se parecen a nada.
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (ta.length === 0 || tb.size === 0) return 0;
  const common = ta.filter((w) => tb.has(w)).length;
  return common / (ta.length + tb.size - common);
}

export const SUGGEST_MIN = 0.5;

// Sugiere enlaces para los modulos del plan que aun no tienen uno, entre los modulos reales que aun no estan usados. Uno a uno y voraz: primero las parejas mas parecidas; con un empate gana
// el orden del plan y el de los modulos reales (resultado estable). No sugiere nada por debajo de SUGGEST_MIN.
export function suggestLinks(bp: Blueprint, real: RealModule[], current: Link[] = []): Suggestion[] {
  const usedNodes = new Set(current.map((l) => l.nodeId));
  const usedModules = new Set(current.map((l) => l.moduleId));
  const pairs: (Suggestion & { ni: number; mi: number })[] = [];
  planModules(bp).forEach((pm, ni) => {
    if (usedNodes.has(pm.nodeId)) return;
    real.forEach((rm, mi) => {
      if (usedModules.has(rm.id)) return;
      const score = similarity(pm.title, rm.title);
      if (score >= SUGGEST_MIN) pairs.push({ nodeId: pm.nodeId, moduleId: rm.id, score: Math.round(score * 1000) / 1000, ni, mi });
    });
  });
  pairs.sort((x, y) => y.score - x.score || x.ni - y.ni || x.mi - y.mi);
  const nodeTaken = new Set<string>();
  const moduleTaken = new Set<string>();
  const out: Suggestion[] = [];
  for (const p of pairs) {
    if (nodeTaken.has(p.nodeId) || moduleTaken.has(p.moduleId)) continue;
    nodeTaken.add(p.nodeId);
    moduleTaken.add(p.moduleId);
    out.push({ nodeId: p.nodeId, moduleId: p.moduleId, score: p.score });
  }
  return out;
}

export type LinksCheck = { ok: true; links: Link[] } | { ok: false; errors: string[] };

// Lo que llega del navegador es no confiable: forma, tamano, que el nodo exista en el plan, que el modulo sea de la clase, y que no haya repetidos.
export function checkLinks(raw: unknown, bp: Blueprint, classModuleIds: Iterable<string>): LinksCheck {
  if (!Array.isArray(raw)) return { ok: false, errors: ['"links" debe ser una lista.'] };
  if (raw.length > MAX_LINKS) return { ok: false, errors: [`No puede haber mas de ${MAX_LINKS} enlaces.`] };
  const nodes = new Set(planModules(bp).map((m) => m.nodeId));
  const modules = new Set(classModuleIds);
  const errors: string[] = [];
  const err = (m: string) => {
    if (errors.length < 20) errors.push(m);
  };
  const seenNode = new Set<string>();
  const seenModule = new Set<string>();
  const links: Link[] = [];
  raw.forEach((l, i) => {
    const o = l && typeof l === 'object' && !Array.isArray(l) ? (l as Record<string, unknown>) : null;
    if (!o || typeof o.nodeId !== 'string' || typeof o.moduleId !== 'string') return err(`links[${i}]: debe tener nodeId y moduleId (texto).`);
    if (!UUID_RE.test(o.moduleId)) return err(`links[${i}].moduleId: no es un identificador valido.`);
    if (!nodes.has(o.nodeId)) return err(`links[${i}].nodeId: el modulo "${o.nodeId.slice(0, 40)}" no existe en el plan.`);
    if (!modules.has(o.moduleId)) return err(`links[${i}].moduleId: ese modulo no es de esta clase.`);
    if (seenNode.has(o.nodeId)) return err(`links[${i}]: el modulo del plan "${o.nodeId}" esta enlazado dos veces.`);
    if (seenModule.has(o.moduleId)) return err(`links[${i}]: un modulo real no puede servir a dos modulos del plan.`);
    seenNode.add(o.nodeId);
    seenModule.add(o.moduleId);
    links.push({ nodeId: o.nodeId, moduleId: o.moduleId });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, links };
}

// Cambia el enlace de UN modulo del plan (moduleId = null lo desenlaza). Si el modulo real ya servia a OTRO nodo, pasa a este (un modulo real solo sirve a un nodo): asi la lista nunca
// queda con un repetido que el servidor rechazaria. No toca los demas enlaces ni el orden.
export function setLink(links: Link[], nodeId: string, moduleId: string | null): Link[] {
  const rest = links.filter((l) => l.nodeId !== nodeId && (moduleId === null || l.moduleId !== moduleId));
  return moduleId === null ? rest : [...rest, { nodeId, moduleId }];
}

// Mezcla sugerencias con los enlaces actuales (las sugerencias solo cubren lo que no estaba enlazado, asi que no pisan nada).
export function applySuggestions(links: Link[], suggestions: Suggestion[]): Link[] {
  return suggestions.reduce((acc, s) => setLink(acc, s.nodeId, s.moduleId), links);
}

// Los enlaces que de verdad corresponden a este plan: descarta los de nodos que el plan ya no tiene (por ejemplo, tras editar el borrador).
export function relevantLinks(bp: Blueprint, links: Link[]): Link[] {
  const nodes = new Set(planModules(bp).map((m) => m.nodeId));
  return links.filter((l) => nodes.has(l.nodeId));
}

// Cuanto del plan ya tiene contenido real enlazado.
export function coverage(bp: Blueprint, links: Link[]): { linked: number; total: number; pending: PlanModule[] } {
  const done = new Set(links.map((l) => l.nodeId));
  const all = planModules(bp);
  const pending = all.filter((m) => !done.has(m.nodeId));
  return { linked: all.length - pending.length, total: all.length, pending };
}
