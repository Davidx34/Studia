// Edicion del plan en la pantalla del profesor: operaciones PURAS e inmutables sobre un Blueprint (la pantalla solo las llama). Mantienen las relaciones consistentes para que editar no
// deje referencias colgando: quitar una comprension la saca de los cortes y de los objetivos; dejar de evaluarla en un corte la saca de los objetivos de ese corte; los ordenes se
// renumeran. Las reglas de fondo siguen siendo de checkBlueprint (que la pantalla corre en vivo) y del servidor (que revalida todo al guardar).

import { equalWeights } from './generate';
import { normalizeText } from './parse';
import { BLUEPRINT_LIMITS as L, type Blueprint, type BlueprintObjective, type Period } from './types';

const allIds = (bp: Blueprint): Set<string> => {
  const ids = new Set<string>();
  for (const o of bp.outcomes) ids.add(o.id);
  for (const p of bp.periods) {
    ids.add(p.id);
    for (const ob of p.objectives) {
      ids.add(ob.id);
      for (const m of ob.modules) ids.add(m.id);
    }
  }
  return ids;
};

// El primer id libre `${prefix}${n}` (los ids son unicos en todo el plan, asi nunca chocan aunque se borre y se agregue).
export function freshId(bp: Blueprint, prefix: string): string {
  const used = allIds(bp);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const renumber = <T extends { order: number }>(xs: T[]): T[] => xs.map((x, i) => ({ ...x, order: i + 1 }));
const mapPeriod = (bp: Blueprint, periodId: string, f: (p: Period) => Period): Blueprint => ({ ...bp, periods: bp.periods.map((p) => (p.id === periodId ? f(p) : p)) });
const mapObjective = (bp: Blueprint, objectiveId: string, f: (ob: BlueprintObjective) => BlueprintObjective): Blueprint => ({
  ...bp,
  periods: bp.periods.map((p) => ({ ...p, objectives: p.objectives.map((ob) => (ob.id === objectiveId ? f(ob) : ob)) })),
});
const toggle = (xs: string[], x: string): string[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

// ───────── comprensiones
export function setOutcomeText(bp: Blueprint, id: string, statement: string): Blueprint {
  return { ...bp, outcomes: bp.outcomes.map((o) => (o.id === id ? { ...o, statement } : o)) };
}
export function addOutcome(bp: Blueprint): Blueprint {
  if (bp.outcomes.length >= L.outcomes) return bp;
  return { ...bp, outcomes: [...bp.outcomes, { id: freshId(bp, 'o'), statement: '' }] };
}
export function removeOutcome(bp: Blueprint, id: string): Blueprint {
  return {
    ...bp,
    outcomes: bp.outcomes.filter((o) => o.id !== id),
    periods: bp.periods.map((p) => ({
      ...p,
      assessesOutcomeIds: p.assessesOutcomeIds.filter((x) => x !== id),
      objectives: p.objectives.map((ob) => ({ ...ob, outcomeIds: ob.outcomeIds.filter((x) => x !== id) })),
    })),
  };
}

// ───────── cortes
export function setPeriod(bp: Blueprint, id: string, patch: { name?: string; weight?: number }): Blueprint {
  return mapPeriod(bp, id, (p) => ({ ...p, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.weight !== undefined ? { weight: patch.weight } : {}) }));
}
export function addPeriod(bp: Blueprint): Blueprint {
  if (bp.periods.length >= L.periods) return bp;
  const p: Period = { id: freshId(bp, 'p'), name: `Corte ${bp.periods.length + 1}`, order: bp.periods.length + 1, weight: 0, assessesOutcomeIds: [], objectives: [] };
  return { ...bp, periods: [...bp.periods, p] };
}
export function removePeriod(bp: Blueprint, id: string): Blueprint {
  return { ...bp, periods: renumber(bp.periods.filter((p) => p.id !== id)) };
}
// Reparte 100 por igual entre los cortes (suma exacta).
export function equalizeWeights(bp: Blueprint): Blueprint {
  if (bp.periods.length === 0) return bp;
  const w = equalWeights(bp.periods.length);
  return { ...bp, periods: bp.periods.map((p, i) => ({ ...p, weight: w[i] })) };
}
// Que el corte evalue (o deje de evaluar) una comprension. Al dejar de evaluarla, los objetivos de ese corte dejan de apuntar a ella.
export function toggleAssessed(bp: Blueprint, periodId: string, outcomeId: string): Blueprint {
  return mapPeriod(bp, periodId, (p) => {
    const was = p.assessesOutcomeIds.includes(outcomeId);
    return {
      ...p,
      assessesOutcomeIds: toggle(p.assessesOutcomeIds, outcomeId),
      objectives: was ? p.objectives.map((ob) => ({ ...ob, outcomeIds: ob.outcomeIds.filter((x) => x !== outcomeId) })) : p.objectives,
    };
  });
}

// ───────── objetivos
export function addObjective(bp: Blueprint, periodId: string): Blueprint {
  const p = bp.periods.find((x) => x.id === periodId);
  if (!p || p.objectives.length >= L.objectivesPerPeriod) return bp;
  const ob: BlueprintObjective = { id: freshId(bp, 'ob'), title: '', outcomeIds: [], modules: [] };
  return mapPeriod(bp, periodId, (q) => ({ ...q, objectives: [...q.objectives, ob] }));
}
export function setObjectiveTitle(bp: Blueprint, id: string, title: string): Blueprint {
  return mapObjective(bp, id, (ob) => ({ ...ob, title }));
}
export function removeObjective(bp: Blueprint, id: string): Blueprint {
  return { ...bp, periods: bp.periods.map((p) => ({ ...p, objectives: p.objectives.filter((ob) => ob.id !== id) })) };
}
// Un objetivo solo puede apuntar a comprensiones que SU corte evalua: si no, no hace nada.
export function toggleObjectiveOutcome(bp: Blueprint, objectiveId: string, outcomeId: string): Blueprint {
  const owner = bp.periods.find((p) => p.objectives.some((ob) => ob.id === objectiveId));
  if (!owner || !owner.assessesOutcomeIds.includes(outcomeId)) return bp;
  return mapObjective(bp, objectiveId, (ob) => ({ ...ob, outcomeIds: toggle(ob.outcomeIds, outcomeId) }));
}

// ───────── modulos
export function addModule(bp: Blueprint, objectiveId: string): Blueprint {
  const owner = bp.periods.flatMap((p) => p.objectives).find((ob) => ob.id === objectiveId);
  if (!owner || owner.modules.length >= L.modulesPerObjective) return bp;
  const id = freshId(bp, 'm');
  return mapObjective(bp, objectiveId, (ob) => ({ ...ob, modules: [...ob.modules, { id, title: '', order: ob.modules.length + 1 }] }));
}
export function setModuleTitle(bp: Blueprint, moduleId: string, title: string): Blueprint {
  return { ...bp, periods: bp.periods.map((p) => ({ ...p, objectives: p.objectives.map((ob) => ({ ...ob, modules: ob.modules.map((m) => (m.id === moduleId ? { ...m, title } : m)) })) })) };
}
export function removeModule(bp: Blueprint, moduleId: string): Blueprint {
  return { ...bp, periods: bp.periods.map((p) => ({ ...p, objectives: p.objectives.map((ob) => ({ ...ob, modules: renumber(ob.modules.filter((m) => m.id !== moduleId)) })) })) };
}

// Textos que faltan por escribir, con un mensaje que el profesor entiende. parseBlueprint (que el servidor corre al guardar) rechaza un texto vacio, pero checkBlueprint no lo ve: sin esta
// revision la pantalla diria "cumple todas las reglas" y el servidor se negaria a guardar.
export function blankFields(bp: Blueprint): string[] {
  const out: string[] = [];
  // El mismo criterio que parseBlueprint (que el servidor corre al guardar): sin espacios ni caracteres de control.
  const blank = (s: string) => normalizeText(s).length === 0;
  bp.outcomes.forEach((o, i) => blank(o.statement) && out.push(`La comprensión final ${i + 1} está vacía.`));
  bp.periods.forEach((p, pi) => {
    if (blank(p.name)) out.push(`El corte ${pi + 1} no tiene nombre.`);
    p.objectives.forEach((ob, oi) => {
      if (blank(ob.title)) out.push(`El objetivo ${oi + 1} del corte ${pi + 1} está vacío.`);
      ob.modules.forEach((m, mi) => blank(m.title) && out.push(`El módulo ${mi + 1} del objetivo ${oi + 1} (corte ${pi + 1}) está vacío.`));
    });
  });
  return out;
}

// Un plan vacio para empezar a mano (sin IA).
export function emptyBlueprint(): Blueprint {
  return equalizeWeights({
    version: 1,
    outcomes: [{ id: 'o1', statement: '' }],
    periods: [{ id: 'p1', name: 'Corte 1', order: 1, weight: 100, assessesOutcomeIds: ['o1'], objectives: [] }],
  });
}
