// Flecha «calibracion del juez -> pipeline»: si el juez NO coincide lo suficiente con las decisiones del profesor, lo que el juez APRUEBA deja de publicarse solo y pasa a revision humana.
//
// Es un interruptor de SEGURIDAD, no de calidad: nunca aprueba nada de mas y nunca rechaza por su cuenta; solo quita al juez la ultima palabra cuando se midio (con muestra suficiente) que no es de fiar.
// Con la calibracion «insufficient» (menos de 20 comparaciones) o «trusted» no hace nada: no se actua sobre ruido.

import type { Calibration } from './judgeCalibration';

export type Verdict = 'pass' | 'fail' | 'review';

export const GUARD_REASON_PREFIX = '[control de calibración] ';

export interface GuardResult {
  verdict: Verdict;
  /** true = el veredicto original era pass y se mando a revision humana por la calibracion. */
  guarded: boolean;
}

export function guardVerdict(verdict: Verdict, calibration: Pick<Calibration, 'status'> | null | undefined): GuardResult {
  if (verdict === 'pass' && calibration?.status === 'degraded') return { verdict: 'review', guarded: true };
  return { verdict, guarded: false };
}

/** Razon que se guarda cuando el interruptor actua: conserva la del juez para que el profesor la vea. */
export function guardedReason(original: string | null | undefined): string {
  return `${GUARD_REASON_PREFIX}El juez aprobó esta pregunta, pero su acuerdo con tus decisiones está por debajo del umbral y por eso la revisas tú. Motivo del juez: ${original ?? '(sin motivo)'}`;
}
