// MONITOR DE REGRESION (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §12). Vigila que un cambio en lo que la IA lee (hoy: el cuaderno de estilo activo) no EMPEORE la calidad de lo que genera, y avisa, con evidencia,
// cuando eso parece ocurrir. La REVERSION la decide el profesor con un clic (volver a la version anterior o desactivar): el monitor propone, nunca revierte solo, igual que el resto de la memoria de la clase.
//
// Que mide: entre las preguntas generadas ANTES y DESPUES de activar el cuaderno actual, la proporcion «buena» (aprobada, o con motivo de rechazo atribuible al generador = mala). Se comparan con la misma
// estadistica de los experimentos (Wilson/Newcombe, minimo 30 por periodo). Dos niveles: «regresion» (el intervalo de la diferencia queda ENTERO del lado malo) y «vigilar» (empeora ≥ 10 puntos pero aun sin
// certeza). Con aprobacion alta (~98 %) y poca muestra casi nunca habra «regresion»: por eso «vigilar» existe y por eso un «estable» NO prueba que el cuaderno sirva.
//
// Limites honestos: el antes y el despues son periodos distintos (otros modulos, otro material): es una comparacion observacional, no un experimento. Si hubo un tramo sin cuaderno entre dos versiones, ese tramo
// cuenta como «antes». El juez es ciego a parte de los errores (docs §11.5): la senal mas confiable es la decision del profesor.
import { compareProportions, type Comparison } from './proportion';
import { CATEGORIES, classifyReason, isFormValidatorReason } from './errorTaxonomy';
import { MIN_DECISIVE, TRUST_THRESHOLD, type Calibration } from './judgeCalibration';

export const WATCH_DROP = 0.1; // «vigilar»: la tasa de buenas cae 10 puntos o mas
export const LONG_QUEUE = 20; // preguntas esperando al profesor

export interface QuestionRow {
  created_at: string;
  review_status: string | null;
  review_reason: string | null;
  reviewed_by?: string | null;
}
export interface PlaybookVersionRow {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'retired';
  activated_at: string | null;
}

export type Outcome = 'good' | 'bad' | 'excluded';

/** Una pregunta es buena (aprobada), mala (rechazada o en revision por un motivo atribuible al generador, o rechazada por el profesor) o se excluye (pendiente, infraestructura, pipeline, validador de forma). */
export function outcomeOf(r: QuestionRow): Outcome {
  if (r.review_status === 'approved') return 'good';
  if (r.review_status === 'rejected' && r.reviewed_by === 'teacher') return 'bad';
  if (r.review_status !== 'rejected' && r.review_status !== 'human_review') return 'excluded';
  if (isFormValidatorReason(r.review_reason)) return 'excluded';
  return CATEGORIES[classifyReason(r.review_reason)].origin === 'generador' ? 'bad' : 'excluded';
}

export interface Tally {
  good: number;
  bad: number;
  excluded: number;
  n: number;
}
export function tally(rows: QuestionRow[]): Tally {
  const t: Tally = { good: 0, bad: 0, excluded: 0, n: 0 };
  for (const r of rows) {
    const o = outcomeOf(r);
    t[o]++;
  }
  t.n = t.good + t.bad;
  return t;
}

export type WatchLevel = 'sin_datos' | 'estable' | 'mejora' | 'vigilar' | 'regresion';

export interface PlaybookWatch {
  version: number;
  activatedAt: string;
  previousVersion: number | null;
  previousId: string | null;
  before: Tally;
  after: Tally;
  comparison: Comparison;
  level: WatchLevel;
}

const t = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);

/** Compara el periodo posterior a la activacion del cuaderno ACTIVO con el periodo anterior (desde la activacion previa, o desde siempre si no habia). null si no hay cuaderno activo. */
export function watchActivePlaybook(playbooks: PlaybookVersionRow[], rows: QuestionRow[]): PlaybookWatch | null {
  const active = playbooks.find((p) => p.status === 'active' && p.activated_at);
  if (!active) return null;
  const start = t(active.activated_at);
  const prev = playbooks
    .filter((p) => p.id !== active.id && p.activated_at && t(p.activated_at) < start)
    .sort((a, b) => t(b.activated_at) - t(a.activated_at))[0];
  const prevStart = prev ? t(prev.activated_at) : -Infinity;
  const after = tally(rows.filter((r) => t(r.created_at) >= start));
  const before = tally(rows.filter((r) => t(r.created_at) < start && t(r.created_at) >= prevStart));
  const comparison = compareProportions({ successes: before.good, n: before.n }, { successes: after.good, n: after.n });
  let level: WatchLevel;
  if (comparison.decision === 'muestra_insuficiente') level = 'sin_datos';
  else if (comparison.decision === 'empeora') level = 'regresion';
  else if (comparison.decision === 'mejora') level = 'mejora';
  else if ((comparison.diff ?? 0) <= -WATCH_DROP + 1e-9) level = 'vigilar';
  else level = 'estable';
  return { version: active.version, activatedAt: active.activated_at!, previousVersion: prev?.version ?? null, previousId: prev?.id ?? null, before, after, comparison, level };
}

export type AlertLevel = 'info' | 'atencion' | 'urgente';
export interface Alert {
  id: 'cuaderno_regresion' | 'cuaderno_vigilar' | 'juez_degradado' | 'cola_larga';
  level: AlertLevel;
  title: string;
  detail: string;
  /** Accion que el profesor puede decidir (el monitor nunca la ejecuta solo). */
  action?: { kind: 'revertir_cuaderno'; toVersion: number | null; toId: string | null } | { kind: 'revisar_cola' };
}

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)} %`);

export interface MonitorInput {
  playbooks: PlaybookVersionRow[];
  questions: QuestionRow[];
  calibration: Calibration | null;
  humanReviewPending: number;
}
export interface MonitorReport {
  watch: PlaybookWatch | null;
  alerts: Alert[];
}

export function monitorReport(input: MonitorInput): MonitorReport {
  const watch = watchActivePlaybook(input.playbooks, input.questions);
  const alerts: Alert[] = [];

  if (watch && (watch.level === 'regresion' || watch.level === 'vigilar')) {
    const c = watch.comparison;
    const ev = `Antes de activar la versión ${watch.version}: ${watch.before.good} de ${watch.before.n} buenas (${pct(c.a.rate)}). Después: ${watch.after.good} de ${watch.after.n} (${pct(c.b.rate)}). Diferencia ${c.diff === null ? '—' : (c.diff * 100).toFixed(1) + ' pp'}, IC95 % ${pct(c.diffCi?.low ?? null)} a ${pct(c.diffCi?.high ?? null)}.`;
    const to = watch.previousVersion === null ? 'desactivar el cuaderno (volver a como generaba antes)' : `volver a la versión ${watch.previousVersion}`;
    alerts.push({
      id: watch.level === 'regresion' ? 'cuaderno_regresion' : 'cuaderno_vigilar',
      level: watch.level === 'regresion' ? 'urgente' : 'atencion',
      title: watch.level === 'regresion' ? `La calidad bajó tras activar la versión ${watch.version} del cuaderno` : `La calidad podría estar bajando tras activar la versión ${watch.version} del cuaderno`,
      detail: `${ev} ${watch.level === 'vigilar' ? 'Aún no es concluyente (podría ser azar o un módulo difícil).' : 'La diferencia es estadísticamente clara.'} Es una comparación entre dos periodos, no un experimento. Puedes ${to}.`,
      action: { kind: 'revertir_cuaderno', toVersion: watch.previousVersion, toId: watch.previousId },
    });
  }

  const cal = input.calibration;
  if (cal && cal.status === 'degraded') {
    alerts.push({
      id: 'juez_degradado',
      level: 'atencion',
      title: 'El juez de IA no coincide lo bastante con tus decisiones',
      detail: `Acuerdo con tus decisiones: ${cal.pairs} comparaciones, cota inferior por debajo del ${Math.round(TRUST_THRESHOLD * 100)} % (mínimo ${MIN_DECISIVE} comparaciones decisivas). Lo que el juez aprueba pasa a tu revisión en vez de publicarse solo.`,
    });
  }

  if (input.humanReviewPending >= LONG_QUEUE) {
    alerts.push({
      id: 'cola_larga',
      level: 'info',
      title: `${input.humanReviewPending} preguntas esperan tu revisión`,
      detail: 'Mientras esperan no llegan a los estudiantes. Cada decisión tuya también mejora la calibración del juez.',
      action: { kind: 'revisar_cola' },
    });
  }
  return { watch, alerts };
}
