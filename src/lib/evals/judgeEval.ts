import { evaluateGates, ratio, round3, type EvalReport, type Gate } from './common';

// Evaluador del JUEZ de preguntas contra un conjunto dorado con alucinaciones SUTILES. Mide lo que mas importa: el FALSO APROBADO (el juez deja pasar una pregunta
// que no debia llegar al estudiante). Un falso rechazo solo desperdicia contenido bueno.
//
// El resultado esperado depende del CRITERIO del juez (JUDGE_CRITERION), porque el proyecto lo cambio a proposito (decision del dueño, 2026-10-27):
//   - 'subject' (por defecto): la pregunta debe ser CORRECTA para la materia; que el dato no aparezca en el material NO es motivo de rechazo.
//   - 'material': la respuesta debe poder verificarse contra el material subido; un dato verdadero pero AUSENTE se rechaza.
// Por eso los casos "ausente pero verdadero" esperan 'reject' con 'material' y 'approve' con 'subject'. Una respuesta que CONTRADICE el material o que es falsa se rechaza con ambos.

export type Criterion = 'subject' | 'material';
export type Expectation = 'approve' | 'reject';
export type JudgeCaseKind = 'fiel' | 'sutil_falsa' | 'contradice_material' | 'ausente_verdadera';

export interface JudgeGoldenCase {
  id: string;
  kind: JudgeCaseKind;
  // El fragmento que el profesor subio.
  material: string;
  // La pregunta, en el formato que recibe el juez (lleva `id`).
  question: { id: string } & Record<string, unknown>;
  expect: Record<Criterion, Expectation>;
  // Por que se espera eso (para quien audite el conjunto).
  note: string;
}

export type JudgeVerdictValue = 'pass' | 'fail' | 'review';
export type JudgeFn = (questions: { id: string }[], material: string) => Promise<Map<string, { verdict: JudgeVerdictValue; reason: string } | null>>;

export const JUDGE_GATES: Gate[] = [
  { metric: 'falseApprovalRate', op: '<=', threshold: 0.1, why: 'una pregunta mala aprobada llega al estudiante' },
  { metric: 'subtleFalseApprovalRate', op: '<=', threshold: 0.15, why: 'las alucinaciones sutiles (casi verdaderas) son las que mas se cuelan' },
  { metric: 'falseRejectRate', op: '<=', threshold: 0.4, why: 'un juez que rechaza contenido bueno (o aplica el criterio equivocado) desperdicia material' },
  { metric: 'answeredRate', op: '>=', threshold: 0.9, why: 'un juez que no responde no mide nada' },
];

export async function runJudgeEval(cases: JudgeGoldenCase[], judge: JudgeFn, criterion: Criterion): Promise<EvalReport> {
  const details: string[] = [];
  let shouldReject = 0;
  let falseApprovals = 0;
  let subtleShouldReject = 0;
  let subtleFalseApprovals = 0;
  let shouldApprove = 0;
  let falseRejects = 0;
  let answered = 0;

  for (const c of cases) {
    const res = await judge([c.question], c.material);
    const v = res.get(c.question.id) ?? null;
    if (v) answered++;
    const want = c.expect[criterion];
    const subtle = c.kind === 'sutil_falsa' || c.kind === 'ausente_verdadera';
    if (want === 'reject') {
      shouldReject++;
      if (subtle) subtleShouldReject++;
      if (v?.verdict === 'pass') {
        falseApprovals++;
        if (subtle) subtleFalseApprovals++;
        details.push(`FALSO APROBADO (${c.kind}) ${c.id}: ${c.note}`);
      }
    } else {
      shouldApprove++;
      if (v?.verdict === 'fail') {
        falseRejects++;
        details.push(`falso rechazo (${c.kind}) ${c.id}: ${v.reason}`);
      }
    }
  }

  const metrics = {
    falseApprovalRate: round3(ratio(falseApprovals, shouldReject, 0)),
    subtleFalseApprovalRate: round3(ratio(subtleFalseApprovals, subtleShouldReject, 0)),
    falseRejectRate: round3(ratio(falseRejects, shouldApprove, 0)),
    answeredRate: round3(ratio(answered, cases.length, 0)),
  };
  details.unshift(`criterio del juez: ${criterion}`);
  return evaluateGates(`eval:judge (${criterion})`, cases.length, metrics, JUDGE_GATES, details);
}
