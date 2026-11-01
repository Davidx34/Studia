// Que hay que rehacer cuando el profesor cambia el plan. Decision del dueño: si se edita una comprension final, SE REGENERA lo de abajo (evaluacion de corte, objetivos, modulos). Pero un
// estudiante que ya hizo un modulo o una evaluacion de corte NO puede perder su intento por culpa de una regeneracion: eso se VERSIONA (lo viejo queda archivado para los que ya lo
// hicieron y se crea una version nueva), y solo lo que nadie ha intentado se reemplaza o se borra.
//
// Esta funcion solo PLANEA (pura, sin base de datos): dice que accion corresponde a cada elemento. Quien aplique el plan (la IA que regenera, la base) viene despues.
//
// Se comparan los dos planes por id: un id que sigue existiendo es "el mismo elemento editado". Que cuenta como cambio:
//   - comprension: cambia su texto (sin importar mayusculas ni espacios), se agrega o se quita;
//   - evaluacion de corte: cambia el conjunto de comprensiones que evalua, o alguna de ellas cambio;
//   - objetivo: cambia el conjunto de comprensiones a las que apunta, o alguna de ellas cambio (cambiar solo su titulo NO obliga a regenerar nada);
//   - modulo: cuelga de un objetivo que se regenera.

import { normalizeText } from './parse';
import type { Blueprint, BlueprintModule, BlueprintObjective, Period } from './types';

// 'keep' no hay que tocarlo; 'regenerate' se rehace en su lugar (nadie lo intento); 'version' se archiva y se crea una version nueva (alguien lo intento);
// 'create' es nuevo; 'delete' se borra (nadie lo intento); 'archive' se quita del plan pero se conserva para los que ya lo hicieron.
export type NodeAction = 'keep' | 'regenerate' | 'version' | 'create' | 'delete' | 'archive';

export interface Attempted {
  // Modulos que algun estudiante ya intento.
  moduleIds?: Iterable<string>;
  // Cortes cuya evaluacion algun estudiante ya tomo.
  periodExamIds?: Iterable<string>;
}

export interface RegenerationPlan {
  outcomes: { id: string; change: 'added' | 'edited' | 'removed' }[];
  periodExams: { id: string; action: NodeAction }[];
  objectives: { id: string; action: NodeAction }[];
  modules: { id: string; action: NodeAction }[];
  summary: Record<NodeAction, number>;
}

const key = (s: string) => normalizeText(s).toLowerCase();
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.indexOf(x) !== -1);

function indexObjectives(bp: Blueprint) {
  const m = new Map<string, { objective: BlueprintObjective; period: Period }>();
  for (const p of bp.periods) for (const o of p.objectives) m.set(o.id, { objective: o, period: p });
  return m;
}
function indexModules(bp: Blueprint) {
  const m = new Map<string, { module: BlueprintModule; objectiveId: string }>();
  for (const p of bp.periods) for (const o of p.objectives) for (const mod of o.modules) m.set(mod.id, { module: mod, objectiveId: o.id });
  return m;
}

export function planRegeneration(oldBp: Blueprint, newBp: Blueprint, attempted: Attempted = {}): RegenerationPlan {
  const doneModules = new Set(attempted.moduleIds ?? []);
  const doneExams = new Set(attempted.periodExamIds ?? []);

  // ---- comprensiones
  const oldOutcomes = new Map(oldBp.outcomes.map((o) => [o.id, o]));
  const newOutcomes = new Map(newBp.outcomes.map((o) => [o.id, o]));
  const outcomes: RegenerationPlan['outcomes'] = [];
  const changed = new Set<string>();
  for (const o of newBp.outcomes) {
    const before = oldOutcomes.get(o.id);
    if (!before) outcomes.push({ id: o.id, change: 'added' }), changed.add(o.id);
    else if (key(before.statement) !== key(o.statement)) outcomes.push({ id: o.id, change: 'edited' }), changed.add(o.id);
  }
  for (const o of oldBp.outcomes) {
    if (!newOutcomes.has(o.id)) outcomes.push({ id: o.id, change: 'removed' }), changed.add(o.id);
  }
  const touches = (ids: string[]) => ids.some((id) => changed.has(id));

  // ---- evaluaciones de corte
  const oldPeriods = new Map(oldBp.periods.map((p) => [p.id, p]));
  const newPeriodIds = new Set(newBp.periods.map((p) => p.id));
  const periodExams: RegenerationPlan['periodExams'] = [];
  for (const p of newBp.periods) {
    const before = oldPeriods.get(p.id);
    if (!before) periodExams.push({ id: p.id, action: 'create' });
    // Si el conjunto no cambio, mirar el viejo o el nuevo da lo mismo; si cambio, ya es un cambio.
    else if (!sameSet(before.assessesOutcomeIds, p.assessesOutcomeIds) || touches(p.assessesOutcomeIds)) {
      periodExams.push({ id: p.id, action: doneExams.has(p.id) ? 'version' : 'regenerate' });
    } else periodExams.push({ id: p.id, action: 'keep' });
  }
  for (const p of oldBp.periods) {
    if (!newPeriodIds.has(p.id)) periodExams.push({ id: p.id, action: doneExams.has(p.id) ? 'archive' : 'delete' });
  }

  // ---- objetivos y modulos
  const oldObjs = indexObjectives(oldBp);
  const newObjs = indexObjectives(newBp);
  const oldMods = indexModules(oldBp);
  const newMods = indexModules(newBp);
  const objectives: RegenerationPlan['objectives'] = [];
  const modules: RegenerationPlan['modules'] = [];
  const regeneratedObjectives = new Set<string>();
  const hasAttempts = (o: BlueprintObjective) => o.modules.some((m) => doneModules.has(m.id));

  for (const p of newBp.periods) {
    for (const o of p.objectives) {
      const before = oldObjs.get(o.id)?.objective;
      let action: NodeAction;
      if (!before) action = 'create';
      else if (!sameSet(before.outcomeIds, o.outcomeIds) || touches(o.outcomeIds)) {
        action = hasAttempts(before) || hasAttempts(o) ? 'version' : 'regenerate';
        regeneratedObjectives.add(o.id);
      } else action = 'keep';
      objectives.push({ id: o.id, action });

      for (const m of o.modules) {
        const beforeMod = oldMods.get(m.id);
        if (!beforeMod) modules.push({ id: m.id, action: 'create' });
        else if (regeneratedObjectives.has(o.id) || beforeMod.objectiveId !== o.id) modules.push({ id: m.id, action: doneModules.has(m.id) ? 'version' : 'regenerate' });
        else modules.push({ id: m.id, action: 'keep' });
      }
    }
  }
  // Lo que ya no esta en el plan: se borra si nadie lo intento, si no se archiva.
  for (const p of oldBp.periods) {
    for (const o of p.objectives) {
      if (!newObjs.has(o.id)) objectives.push({ id: o.id, action: hasAttempts(o) ? 'archive' : 'delete' });
      for (const m of o.modules) if (!newMods.has(m.id)) modules.push({ id: m.id, action: doneModules.has(m.id) ? 'archive' : 'delete' });
    }
  }

  const summary: Record<NodeAction, number> = { keep: 0, regenerate: 0, version: 0, create: 0, delete: 0, archive: 0 };
  for (const n of [...periodExams, ...objectives, ...modules]) summary[n.action]++;
  return { outcomes, periodExams, objectives, modules, summary };
}
