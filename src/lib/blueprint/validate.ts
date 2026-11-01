// Reglas del plan "hacia atras". parseBlueprint ya garantizo la FORMA; aqui se comprueba que el plan sea COHERENTE de punta a punta:
//
//   1. los cortes suman 100 y cada uno pesa algo;
//   2. toda comprension final la evalua al menos un corte (si no, el curso no termina de comprobar lo que dice que ensena);
//   3. todo corte evalua algo, y para cada cosa que evalua hay al menos un objetivo que la ensena (no se evalua lo que no se ensena);
//   4. todo objetivo apunta a comprensiones que SU corte evalua (no se ensena para un examen que no existe) y tiene modulos;
//   5. el orden de cortes, y de modulos dentro de un objetivo, no se repite.
//
// Devuelve TODOS los problemas (no se detiene en el primero) con el id del elemento afectado. 'error' impide publicar; 'warning' solo avisa. Codigo puro.

import { normalizeText } from './parse';
import type { Blueprint, Issue, IssueCode, IssueSeverity } from './types';

// Tolerancia de redondeo: un centesimo de punto (33.33 + 33.33 + 33.33 = 99.99 es un reparto en tercios y se acepta). Se compara en centesimas ENTERAS: en punto flotante
// 100 - 99.99 da 0.01000000000000512 y fallaria justo en el limite.
const WEIGHT_TOLERANCE_CENTS = 1;

export function checkBlueprint(bp: Blueprint): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: IssueSeverity, code: IssueCode, message: string, ref?: string) => issues.push({ severity, code, message, ...(ref ? { ref } : {}) });

  if (bp.outcomes.length === 0) add('error', 'noOutcomes', 'Escribe al menos una comprensión final: es lo que el curso debe lograr.');
  if (bp.periods.length === 0) add('error', 'noPeriods', 'Define al menos un corte.');

  const outcomeById = new Map(bp.outcomes.map((o) => [o.id, o]));

  // 1. Ponderaciones.
  let sum = 0;
  for (const p of bp.periods) {
    sum += p.weight;
    if (!(p.weight > 0 && p.weight <= 100)) add('error', 'weightRange', `El corte «${p.name}» debe pesar más de 0 y como máximo 100.`, p.id);
  }
  if (bp.periods.length > 0 && Math.abs(Math.round(sum * 100) - 10000) > WEIGHT_TOLERANCE_CENTS) add('error', 'weightSum', `Los cortes suman ${round2(sum)} y deben sumar 100.`);

  // Comprensiones repetidas (aviso).
  const seenText = new Map<string, string>();
  for (const o of bp.outcomes) {
    const key = normalizeText(o.statement).toLowerCase();
    const first = seenText.get(key);
    if (first) add('warning', 'duplicateOutcome', `La comprensión «${o.statement}» está repetida.`, o.id);
    else seenText.set(key, o.id);
  }

  // 2. Cobertura de la evaluacion final: cada comprension, evaluada por algun corte.
  const assessedSomewhere = new Set<string>();
  for (const p of bp.periods) for (const id of p.assessesOutcomeIds) assessedSomewhere.add(id);
  for (const o of bp.outcomes) {
    if (!assessedSomewhere.has(o.id)) add('error', 'outcomeNotAssessed', `Ningún corte evalúa la comprensión «${o.statement}».`, o.id);
  }

  // Orden de cortes.
  const periodOrders = new Set<number>();
  for (const p of bp.periods) {
    if (periodOrders.has(p.order)) add('error', 'duplicateOrder', `Dos cortes tienen el mismo orden (${p.order}).`, p.id);
    periodOrders.add(p.order);
  }

  for (const p of bp.periods) {
    // 3. Lo que evalua el corte.
    if (p.assessesOutcomeIds.length === 0) add('error', 'periodAssessesNothing', `El corte «${p.name}» no evalúa ninguna comprensión.`, p.id);
    for (const id of p.assessesOutcomeIds) {
      if (!outcomeById.has(id)) add('error', 'unknownOutcome', `El corte «${p.name}» evalúa una comprensión que no existe («${id}»).`, p.id);
    }
    if (p.objectives.length === 0) add('error', 'periodWithoutObjectives', `El corte «${p.name}» no tiene objetivos.`, p.id);

    const taught = new Set<string>();
    for (const ob of p.objectives) {
      // 4. Trazabilidad del objetivo.
      if (ob.outcomeIds.length === 0) add('error', 'objectiveWithoutOutcome', `El objetivo «${ob.title}» no apunta a ninguna comprensión final.`, ob.id);
      for (const id of ob.outcomeIds) {
        taught.add(id);
        if (!outcomeById.has(id)) add('error', 'unknownOutcome', `El objetivo «${ob.title}» apunta a una comprensión que no existe («${id}»).`, ob.id);
        else if (p.assessesOutcomeIds.indexOf(id) === -1) add('error', 'objectiveOutsideExam', `El objetivo «${ob.title}» apunta a «${outcomeById.get(id)!.statement}», que el corte «${p.name}» no evalúa.`, ob.id);
      }
      if (ob.modules.length === 0) add('error', 'objectiveWithoutModules', `El objetivo «${ob.title}» no tiene módulos.`, ob.id);
      const moduleOrders = new Set<number>();
      for (const m of ob.modules) {
        if (moduleOrders.has(m.order)) add('error', 'duplicateOrder', `Dos módulos del objetivo «${ob.title}» tienen el mismo orden (${m.order}).`, m.id);
        moduleOrders.add(m.order);
      }
    }
    // 3b. No se evalua lo que no se ensena.
    for (const id of p.assessesOutcomeIds) {
      const o = outcomeById.get(id);
      if (o && !taught.has(id)) add('error', 'assessedWithoutObjective', `El corte «${p.name}» evalúa «${o.statement}», pero ningún objetivo del corte la enseña.`, p.id);
    }
  }

  return issues;
}

export const isPublishable = (issues: Issue[]): boolean => !issues.some((i) => i.severity === 'error');

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
