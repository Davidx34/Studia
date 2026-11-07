// Fase 2 de «IA que aprende»: calibrar al juez IA contra la decision del profesor.
//
// El juez NO es la unica fuente de verdad (Goodhart): solo "gana peso" si su acuerdo con el profesor supera un umbral MEDIDO con intervalo de confianza. Con pocos datos el estado es
// 'insufficient' y NO se concluye nada. Este modulo es puro (sin base de datos): recibe eventos de ai_feedback_events y devuelve metricas.

export type JudgeSignal = 'judge' | 'teacher' | 'unknown';
export type ReviewVerdict = 'pending' | 'approved' | 'rejected' | 'human_review';

export interface FeedbackEvent {
  question_id: string | null;
  signal: JudgeSignal;
  verdict: ReviewVerdict;
  reason: string | null;
  created_at: string;
}

export type JudgeSaid = 'pass' | 'fail' | 'review';
export type CalibrationStatus = 'insufficient' | 'trusted' | 'degraded';

export interface Pair {
  questionId: string;
  judge: JudgeSaid;
  teacher: 'approved' | 'rejected';
}

export interface Calibration {
  /** Preguntas con decision del profesor Y veredicto del juez conocido. */
  pairs: number;
  /** Decisiones del profesor sin veredicto previo del juez recuperable (no entran en la medida). */
  unpaired: number;
  /** Pares donde el juez fue decisivo (pass o fail). Los 'review' no cuentan ni a favor ni en contra. */
  decisive: number;
  agree: number;
  /** El juez dijo pass y el profesor rechazo: lo mas danino (llega al estudiante). */
  falsePass: number;
  /** El juez dijo fail y el profesor aprobo: se pierde una pregunta buena. */
  falseFail: number;
  review: number;
  agreementRate: number | null;
  /** Cota inferior del intervalo de Wilson al 95 %: lo que se puede afirmar con esta muestra. */
  lowerBound: number | null;
  status: CalibrationStatus;
  /** 1 = confiar, 0 = no confiar sin revision humana, null = aun no se sabe. */
  weight: 0 | 1 | null;
  minDecisive: number;
  threshold: number;
}

export const MIN_DECISIVE = 20;
export const TRUST_THRESHOLD = 0.8;

const JUDGE_FROM_STATUS: Record<string, JudgeSaid | undefined> = { approved: 'pass', rejected: 'fail', human_review: 'review' };
const REASON_TAG = /\[juez actual:\s*(pass|fail|review)\]/i;

/** Cota inferior del intervalo de Wilson (z = 1.96). */
export function wilsonLower(successes: number, n: number, z = 1.96): number | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / denom);
}

/** Empareja, por pregunta, la ultima decision del profesor con el ultimo veredicto del juez anterior a ella. */
export function pairJudgeTeacher(events: FeedbackEvent[]): { pairs: Pair[]; unpaired: number } {
  const byQuestion = new Map<string, FeedbackEvent[]>();
  for (const e of events) {
    if (!e.question_id) continue;
    const list = byQuestion.get(e.question_id) ?? [];
    list.push(e);
    byQuestion.set(e.question_id, list);
  }
  const pairs: Pair[] = [];
  let unpaired = 0;
  for (const [questionId, list] of byQuestion) {
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const teacher = [...sorted].reverse().find((e) => e.signal === 'teacher' && (e.verdict === 'approved' || e.verdict === 'rejected'));
    if (!teacher) continue;
    const before = sorted.filter((e) => e.signal === 'judge' && e.created_at <= teacher.created_at);
    const lastJudge = before.length ? JUDGE_FROM_STATUS[before[before.length - 1].verdict] : undefined;
    // Las decisiones anteriores a la migracion 096 guardaron el veredicto del juez como texto en la razon del profesor.
    const fromReason = (teacher.reason?.match(REASON_TAG)?.[1].toLowerCase() as JudgeSaid | undefined) ?? undefined;
    const judge = lastJudge ?? fromReason;
    if (!judge) {
      unpaired++;
      continue;
    }
    pairs.push({ questionId, judge, teacher: teacher.verdict as 'approved' | 'rejected' });
  }
  return { pairs, unpaired };
}

export function calibrateJudge(events: FeedbackEvent[], opts: { minDecisive?: number; threshold?: number } = {}): Calibration {
  const minDecisive = opts.minDecisive ?? MIN_DECISIVE;
  const threshold = opts.threshold ?? TRUST_THRESHOLD;
  const { pairs, unpaired } = pairJudgeTeacher(events);
  let agree = 0;
  let falsePass = 0;
  let falseFail = 0;
  let review = 0;
  for (const p of pairs) {
    if (p.judge === 'review') review++;
    else if ((p.judge === 'pass') === (p.teacher === 'approved')) agree++;
    else if (p.judge === 'pass') falsePass++;
    else falseFail++;
  }
  const decisive = agree + falsePass + falseFail;
  const agreementRate = decisive ? agree / decisive : null;
  const lowerBound = wilsonLower(agree, decisive);
  let status: CalibrationStatus = 'insufficient';
  if (decisive >= minDecisive && lowerBound !== null) status = lowerBound >= threshold ? 'trusted' : 'degraded';
  const weight = status === 'trusted' ? 1 : status === 'degraded' ? 0 : null;
  return { pairs: pairs.length, unpaired, decisive, agree, falsePass, falseFail, review, agreementRate, lowerBound, status, weight, minDecisive, threshold };
}
