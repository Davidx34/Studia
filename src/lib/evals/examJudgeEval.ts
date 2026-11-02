import { judgeExamQuestion, type JudgeOutcome, type JudgeVerdict, type ModelCaller } from '@/lib/blueprint/examJudge';
import type { ExamQuestion } from '@/lib/blueprint/examQuestion';
import type { SourceChunk } from '@/lib/blueprint/examGenerate';
import { evaluateGates, ratio, round3, type EvalReport, type Gate } from './common';

// Evaluador del JUEZ DE SUSTENTO (src/lib/blueprint/examJudge.ts) con el modelo real. A diferencia de los otros eval, aqui SI hay respuesta conocida: casos bien respaldados por el
// material y casos MALOS plantados a proposito. Lo que importa es (1) que no APRUEBE lo malo (riesgo que motivo el juez), (2) que no rechace lo bueno (costo: se tira trabajo valido) y
// (3) que no se quede en "no se" demasiado a menudo. La ambiguedad se informa aparte: es la prueba mas dificil.

export interface ExamJudgeCase {
  id: string;
  question: ExamQuestion;
  chunks: SourceChunk[];
  expected: JudgeVerdict;
}

export type JudgeFn = typeof judgeExamQuestion;
export type JudgeGenerator = (c: ExamJudgeCase) => ModelCaller;

export const EXAM_JUDGE_GATES: Gate[] = [
  { metric: 'badApprovedRate', op: '<=', threshold: 0.2, why: 'el juez existe para NO aprobar preguntas con respuestas o explicaciones que el material no respalda' },
  { metric: 'goodRejectedRate', op: '<=', threshold: 0.25, why: 'si rechaza demasiado lo bueno, se tira trabajo valido y el profesor revisa de mas' },
  { metric: 'unclearRate', op: '<=', threshold: 0.3, why: 'un juez que casi siempre dice "no se" no controla nada' },
];

export async function runExamJudgeEval(cases: ExamJudgeCase[], generator: JudgeGenerator, deps: { judge?: JudgeFn } = {}): Promise<EvalReport> {
  const judge = deps.judge ?? judgeExamQuestion;
  const details: string[] = [];
  let good = 0;
  let goodRejected = 0;
  let goodApproved = 0;
  let bad = 0;
  let badApproved = 0;
  let badCaught = 0;
  let ambiguous = 0;
  let ambiguousFlagged = 0;
  let unclear = 0;
  let judged = 0;

  for (const c of cases) {
    const r: JudgeOutcome = await judge(c.question, c.chunks, generator(c));
    judged++;
    if (r.verdict === 'unclear') unclear++;
    const mark = r.verdict === c.expected ? 'ok ' : r.verdict === 'unclear' ? '?  ' : 'MAL';
    details.push(`${mark} ${c.id}: esperado ${c.expected}, el juez dijo ${r.verdict}${r.problems.length ? ' — ' + r.problems[0].slice(0, 110) : ''}`);
    if (c.expected === 'supported') {
      good++;
      if (r.verdict === 'unsupported') goodRejected++;
      if (r.verdict === 'supported') goodApproved++;
    } else if (c.expected === 'unsupported') {
      bad++;
      if (r.verdict === 'supported') badApproved++;
      else if (r.verdict === 'unsupported') badCaught++;
    } else {
      ambiguous++;
      if (r.verdict !== 'supported') ambiguousFlagged++;
      // Una pregunta ambigua que el juez APRUEBA es un fallo igual de serio que una mal respaldada.
      if (r.verdict === 'supported') badApproved++;
      bad++;
    }
  }

  const metrics = {
    badApprovedRate: round3(ratio(badApproved, bad)),
    goodRejectedRate: round3(ratio(goodRejected, good)),
    unclearRate: round3(ratio(unclear, judged)),
    // informativas
    badCaughtExactly: round3(ratio(badCaught, bad - ambiguous)),
    goodApprovedRate: round3(ratio(goodApproved, good)),
    ambiguousFlaggedRate: round3(ratio(ambiguousFlagged, ambiguous)),
  };
  return evaluateGates('eval:exam-judge', cases.length, metrics, EXAM_JUDGE_GATES, details);
}
