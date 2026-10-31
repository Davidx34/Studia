import { designLab, type ModelCaller, type DesignResult } from '@/lib/lab/design';
import { validateLabSpec } from '@/lib/lab/labSpec';
import type { Graph } from '@/lib/memory/types';
import { evaluateGates, ratio, round3, type EvalReport, type Gate } from './common';

// Evaluador de EXTREMO A EXTREMO del diseñador de laboratorios: dada una idea del profesor y la memoria de su clase, ¿la IA (1) reconoce correctamente si los materiales
// bastan (sufficient | partial | insufficient), (2) NO inventa un laboratorio cuando faltan los materiales, y (3) cuando disena, el modelo es valido y coherente
// numericamente con las ecuaciones de los apuntes?
//
// El "generador" bajo prueba es el modelo (ModelCaller); `designLab` es la tuberia real (requisitos, prueba de suficiencia, diseno con reintento guiado,
// validacion numerica, cotejo de formulas). Ambos se inyectan para poder poner uno defectuoso.

export type Sufficiency = 'sufficient' | 'partial' | 'insufficient';
export type Expected = Sufficiency | 'noFit';

export interface LabGoldenCase {
  id: string;
  idea: string;
  graph: Graph;
  expected: Expected;
}

export type LabGenerator = (c: LabGoldenCase) => ModelCaller;
export type DesignFn = typeof designLab;

// Una formula 'divergente' (formulaMatch) coincide con la ecuacion de los apuntes en menos del 100 % de los puntos probados. Si coincide en la MAYORIA es casi siempre un
// tope o una condicion legitima del modelo (por ejemplo `max(..., 0)` para que una cantidad no sea negativa): se informa, pero no frena. Si coincide en menos de la mitad,
// la formula contradice los apuntes. El corte de 0,5 es de ESTE evaluador, no una regla del producto.

export const CONTRADICTION_AGREEMENT = 0.5;

export const LAB_DESIGN_GATES: Gate[] = [
  { metric: 'sufficiencyAccuracy', op: '>=', threshold: 0.8, why: 'decidir bien si los materiales bastan es lo que evita laboratorios inventados' },
  { metric: 'designForInsufficientRate', op: '<=', threshold: 0, why: 'nunca debe salir un laboratorio cuando faltan los materiales esenciales' },
  { metric: 'invalidAcceptedRate', op: '<=', threshold: 0, why: 'un modelo que no pasa la validacion no puede publicarse' },
  { metric: 'contradictoryFormulaRate', op: '<=', threshold: 0, why: 'una formula que contradice los apuntes le ensenia algo falso al estudiante' },
  { metric: 'designRate', op: '>=', threshold: 0.8, why: 'cuando los materiales bastan, la IA debe lograr un laboratorio valido' },
];

function classify(res: DesignResult): Expected | 'error' {
  if (res.ok) return res.coverage.verdict;
  if (res.coverage) return res.coverage.verdict;
  return res.reason === 'noFit' ? 'noFit' : 'error';
}

export async function runLabDesignEval(cases: LabGoldenCase[], generator: LabGenerator, deps: { design?: DesignFn } = {}): Promise<EvalReport> {
  const design = deps.design ?? designLab;
  const details: string[] = [];
  let correct = 0;
  let insufficientCases = 0;
  let designForInsufficient = 0;
  let accepted = 0;
  let invalidAccepted = 0;
  let sufficientCases = 0;
  let sufficientDesigned = 0;
  let sufficientDivergent = 0;
  let sufficientContradictory = 0;

  for (const c of cases) {
    // allowPartial: un caso 'partial' debe llegar a disenarse para poder medir su calidad; 'insufficient' nunca debe pasar.
    const res = await design({ idea: c.idea, graph: c.graph, allowPartial: true }, generator(c));
    const got = classify(res);
    if (got === c.expected) correct++;
    else details.push(`${c.id}: se clasifico como ${got}, se esperaba ${c.expected}${res.ok ? '' : ` (${res.message})`}`);

    if (c.expected === 'insufficient') {
      insufficientCases++;
      if (res.ok) {
        designForInsufficient++;
        details.push(`${c.id}: DISEÑO INVENTADO con materiales insuficientes`);
      }
    }
    if (c.expected === 'sufficient') sufficientCases++;

    if (res.ok) {
      accepted++;
      // Se vuelve a validar por separado (no se confia en que la tuberia lo hizo): la ficha publicada debe pasar la validacion completa.
      const again = validateLabSpec({ template: 'modelo', title: res.spec.title, model: res.spec.model });
      if (!again.ok) {
        invalidAccepted++;
        details.push(`${c.id}: la ficha aceptada NO pasa la validacion: ${again.errors.slice(0, 2).join(' | ')}`);
      }
      if (c.expected === 'sufficient') {
        sufficientDesigned++;
        const divergent = res.formulaChecks.filter((f) => f.status === 'divergent');
        if (divergent.length > 0) sufficientDivergent++;
        const contradictory = divergent.filter((f) => f.agreement < CONTRADICTION_AGREEMENT);
        if (contradictory.length > 0) {
          sufficientContradictory++;
          details.push(`${c.id}: formula(s) que CONTRADICEN los apuntes: ${contradictory.map((d) => `${d.label} (${Math.round(d.agreement * 100)} %)`).join(', ')}`);
        }
      }
    }
  }

  const metrics = {
    sufficiencyAccuracy: round3(ratio(correct, cases.length, 0)),
    designForInsufficientRate: round3(ratio(designForInsufficient, insufficientCases, 0)),
    invalidAcceptedRate: round3(ratio(invalidAccepted, accepted, 0)),
    contradictoryFormulaRate: round3(ratio(sufficientContradictory, sufficientDesigned, 0)),
    // Informativa (sin compuerta): ver CONTRADICTION_AGREEMENT.
    divergentFormulaRate: round3(ratio(sufficientDivergent, sufficientDesigned, 0)),
    designRate: round3(ratio(sufficientDesigned, sufficientCases, 1)),
  };
  return evaluateGates('eval:lab-design', cases.length, metrics, LAB_DESIGN_GATES, details);
}
