// BUCLE ITERATIVO CON JUEZ EXTERNO (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §13). Un revisor externo fuerte (un modelo operado por una persona desde una sesion de Claude Code; la app NUNCA lo llama en
// produccion) recibe un LOTE de preguntas generadas en local, las revisa con el mismo catalogo de defectos del auditor, CORRIGE las corregibles y devuelve una REVISION. Este modulo es la parte pura:
// valida que la revision sea estricta y trazable, calcula la calidad con intervalo de Wilson al 95 %, mide la calibracion del juez de la app contra el revisor externo y decide si el revisor externo
// ya esta VALIDADO frente al profesor (hasta entonces sus decisiones no mueven nada en produccion: entran como «en revision humana»).
//
// Veredictos del revisor externo:
//   bueno     usable tal cual (sin defectos criticos ni mayores)
//   corregir  tiene defectos pero se arregla; trae la version corregida (que debe pasar el validador de forma)
//   malo      no vale la pena arreglarlo; se descarta
// Dos tasas distintas, nunca mezcladas: CRUDA (bueno / n: calidad del generador tal como sale) y ENTREGABLE ((bueno + corregir) / n: lo que entra al banco tras la correccion).
import { isValidQuestion } from '@/lib/lesson/validateQuestion';
import { DEFECT_CODES, fullText, type AuditDefect, type Severity } from '@/lib/questions/auditor';
import { wilsonInterval, type Interval } from './proportion';
import { wilsonLower, MIN_DECISIVE, TRUST_THRESHOLD } from './judgeCalibration';
import type { ErrorCategory } from './errorTaxonomy';

export type ExternalVerdict = 'bueno' | 'corregir' | 'malo';
export const VERDICTS: ExternalVerdict[] = ['bueno', 'corregir', 'malo'];
export const SEVERITIES: Severity[] = ['critico', 'mayor', 'menor'];
export const TARGET_GOOD = 0.9; // meta de producto: ≈ 90 % buenas

export interface LotItem {
  id: string;
  module_id: string;
  module_title: string;
  question: any; // la pregunta tal como la genero la app (type, q, opts, ok, exp, answers, keywords, concept_tag)
  judge?: { verdict: 'pass' | 'fail' | 'review'; reason: string } | null; // veredicto del juez de la app sobre esta pregunta, si se corrio
}
export interface Lot {
  id: string;
  fecha: string;
  generador: string;
  arm: string; // 'base' | 'reglas:<conjunto>' | ...
  items: LotItem[];
}
export interface ReviewItem {
  id: string;
  veredicto: ExternalVerdict;
  defectos: AuditDefect[];
  corregida?: any;
  nota?: string;
}
export interface Revision {
  revisor: string;
  fecha: string;
  lote: string;
  items: ReviewItem[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Una revision es valida solo si es estricta: cada pregunta revisada una vez, defectos con codigo y CITA verificable, y las correcciones pasan el validador de forma. Devuelve la lista de problemas (vacia = valida). */
export function validateRevision(lot: Lot, rev: Revision): string[] {
  const errors: string[] = [];
  if (rev.lote !== lot.id) errors.push(`la revision es del lote «${rev.lote}», no de «${lot.id}»`);
  if (!rev.revisor || !rev.fecha) errors.push('faltan revisor o fecha');
  const byId = new Map(lot.items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  for (const r of rev.items ?? []) {
    const it = byId.get(r.id);
    if (!it) {
      errors.push(`${r.id}: no existe en el lote`);
      continue;
    }
    if (seen.has(r.id)) errors.push(`${r.id}: revisada dos veces`);
    seen.add(r.id);
    if (!VERDICTS.includes(r.veredicto)) {
      errors.push(`${r.id}: veredicto invalido «${r.veredicto}»`);
      continue;
    }
    const hay = norm(fullText(it.question));
    for (const d of r.defectos ?? []) {
      if (!(d.code in DEFECT_CODES)) errors.push(`${r.id}: codigo de defecto desconocido «${d.code}»`);
      if (!SEVERITIES.includes(d.severity)) errors.push(`${r.id}: severidad invalida «${d.severity}»`);
      if (!d.quote || d.quote.trim().length < 6 || !hay.includes(norm(d.quote).slice(0, 60))) errors.push(`${r.id}: la cita del defecto «${d.code}» no aparece en la pregunta`);
    }
    const serios = (r.defectos ?? []).filter((d) => d.severity !== 'menor');
    if (r.veredicto === 'bueno' && serios.length > 0) errors.push(`${r.id}: marcada «bueno» pero tiene defectos criticos o mayores`);
    if ((r.veredicto === 'corregir' || r.veredicto === 'malo') && (r.defectos ?? []).length === 0) errors.push(`${r.id}: «${r.veredicto}» exige al menos un defecto con cita`);
    if (r.veredicto === 'corregir') {
      if (!r.corregida) errors.push(`${r.id}: «corregir» exige la version corregida`);
      else {
        const v = isValidQuestion(r.corregida);
        if (!v.valid) errors.push(`${r.id}: la version corregida no pasa el validador de forma (${(v as any).error ?? 'invalida'})`);
        if (r.corregida.type !== it.question.type) errors.push(`${r.id}: la correccion cambia el tipo de pregunta`);
        if (JSON.stringify(r.corregida) === JSON.stringify(it.question)) errors.push(`${r.id}: la «correccion» es identica a la original`);
      }
    }
  }
  for (const it of lot.items) if (!seen.has(it.id)) errors.push(`${it.id}: falta su revision`);
  return errors;
}

export interface Rate {
  k: number;
  n: number;
  rate: number | null;
  ci: Interval | null;
}
const rate = (k: number, n: number): Rate => ({ k, n, rate: n ? k / n : null, ci: wilsonInterval(k, n) });

export type GoalStatus = 'cumple' | 'probable' | 'no_alcanzada' | 'sin_datos';
export interface GoalCheck {
  target: number;
  status: GoalStatus;
  /** Con la tasa observada, cuantas preguntas hacen falta para que el limite inferior del IC 95 % llegue a la meta (null si la tasa observada no llega a la meta). */
  neededN: number | null;
}

/** «cumple» = el limite inferior del IC 95 % ya llega a la meta; «probable» = la tasa observada la alcanza pero el intervalo aun no la garantiza; «no_alcanzada» = la tasa observada esta por debajo. */
export function goalCheck(k: number, n: number, target = TARGET_GOOD): GoalCheck {
  if (n === 0) return { target, status: 'sin_datos', neededN: null };
  const p = k / n;
  const ci = wilsonInterval(k, n)!;
  if (ci.low >= target) return { target, status: 'cumple', neededN: n };
  if (p < target) return { target, status: 'no_alcanzada', neededN: null };
  return { target, status: 'probable', neededN: sampleSizeForLower(p, target) };
}

/** Menor n tal que, manteniendo la tasa p, el limite inferior de Wilson llega a `target` (null si p no supera a target o n > 100000). */
export function sampleSizeForLower(p: number, target: number): number | null {
  if (p <= target) return null;
  for (let n = 10; n <= 100000; n = n < 200 ? n + 5 : Math.ceil(n * 1.03)) {
    const lo = wilsonInterval(Math.round(p * n), n)!.low;
    if (lo >= target) return n;
  }
  return null;
}

export interface RoundSummary {
  n: number;
  cruda: Rate; // bueno / n
  entregable: Rate; // (bueno + corregir) / n
  veredictos: Record<ExternalVerdict, number>;
  defectosPorCodigo: Record<string, number>;
  defectosSeriosPorCodigo: Record<string, number>;
  metaCruda: GoalCheck;
  metaEntregable: GoalCheck;
}

export function summarizeRound(rev: Pick<Revision, 'items'>): RoundSummary {
  const v: Record<ExternalVerdict, number> = { bueno: 0, corregir: 0, malo: 0 };
  const dc: Record<string, number> = {};
  const ds: Record<string, number> = {};
  for (const r of rev.items) {
    v[r.veredicto]++;
    for (const d of r.defectos ?? []) {
      dc[d.code] = (dc[d.code] ?? 0) + 1;
      if (d.severity !== 'menor') ds[d.code] = (ds[d.code] ?? 0) + 1;
    }
  }
  const n = rev.items.length;
  return { n, cruda: rate(v.bueno, n), entregable: rate(v.bueno + v.corregir, n), veredictos: v, defectosPorCodigo: dc, defectosSeriosPorCodigo: ds, metaCruda: goalCheck(v.bueno, n), metaEntregable: goalCheck(v.bueno + v.corregir, n) };
}

// Codigo de defecto -> categoria de la taxonomia de errores (para reusar las plantillas de reglas ya revisadas, y NO inventar reglas nuevas desde una sola ronda).
export const DEFECT_TO_CATEGORY: Record<string, ErrorCategory> = {
  respuesta_incorrecta: 'error_conceptual_o_calculo',
  calculo_erroneo: 'error_conceptual_o_calculo',
  explicacion_contradice: 'error_conceptual_o_calculo',
  mas_de_una_correcta: 'ambiguedad_respuesta_unica',
  ninguna_correcta: 'ambiguedad_respuesta_unica',
  ambigua: 'redaccion_confusa',
  dato_faltante: 'no_autocontenida',
  dato_inventado: 'anclaje_material',
  pista_accidental: 'otro',
  distractor_absurdo: 'otro',
  trivial: 'otro',
  nivel_inadecuado: 'otro',
};

/** Conteos de categorias de la taxonomia a partir de los defectos SERIOS de una ronda (insumo para proponer reglas; las propone ruleProposals, que exige evidencia minima). */
export function categoryCounts(s: Pick<RoundSummary, 'defectosSeriosPorCodigo'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, n] of Object.entries(s.defectosSeriosPorCodigo)) {
    const c = DEFECT_TO_CATEGORY[code] ?? 'otro';
    out[c] = (out[c] ?? 0) + n;
  }
  return out;
}

// ---------- Calibracion ----------
export interface JudgeExternalPair {
  judge: 'pass' | 'fail' | 'review';
  ext: ExternalVerdict;
}
export interface JudgeVsExternal {
  pairs: number;
  /** El juez dijo «pass» y el externo dijo corregir/malo: defecto que el juez dejo pasar. */
  falsePass: number;
  judgePass: number;
  /** De lo que el juez aprueba, que fraccion es realmente buena segun el externo (precision del «pass»). */
  passPrecision: Rate;
  /** El juez rechazo o mando a revision algo que el externo considera bueno. */
  falseAlarm: number;
}
export function judgeVsExternal(pairs: JudgeExternalPair[]): JudgeVsExternal {
  const passes = pairs.filter((p) => p.judge === 'pass');
  const falsePass = passes.filter((p) => p.ext !== 'bueno').length;
  const falseAlarm = pairs.filter((p) => p.judge !== 'pass' && p.ext === 'bueno').length;
  return { pairs: pairs.length, falsePass, judgePass: passes.length, passPrecision: rate(passes.length - falsePass, passes.length), falseAlarm };
}

export type ValidationStatus = 'validado' | 'no_validado' | 'sin_datos';
export interface ExternalValidation {
  pairs: number;
  agree: number;
  /** El externo dijo «bueno» y el profesor rechazo (o viceversa). */
  falsePass: number;
  falseReject: number;
  agreement: Rate;
  lowerBound: number | null;
  status: ValidationStatus;
}
/** Compuerta: el revisor externo solo se considera VALIDADO si, sobre preguntas que tambien decidio el profesor, su acuerdo tiene cota inferior de Wilson ≥ 80 % con al menos 20 comparaciones. */
export function validateExternal(pairs: { ext: ExternalVerdict; teacher: 'approved' | 'rejected' }[]): ExternalValidation {
  const agree = pairs.filter((p) => (p.ext === 'bueno') === (p.teacher === 'approved')).length;
  const falsePass = pairs.filter((p) => p.ext === 'bueno' && p.teacher === 'rejected').length;
  const falseReject = pairs.filter((p) => p.ext !== 'bueno' && p.teacher === 'approved').length;
  const lowerBound = wilsonLower(agree, pairs.length);
  const status: ValidationStatus = pairs.length < MIN_DECISIVE ? 'sin_datos' : lowerBound !== null && lowerBound >= TRUST_THRESHOLD ? 'validado' : 'no_validado';
  return { pairs: pairs.length, agree, falsePass, falseReject, agreement: rate(agree, pairs.length), lowerBound, status };
}

/** Estado en el que se inserta al banco una pregunta aprobada por el externo: solo con el revisor VALIDADO entra como aprobada; si no, entra «en revision humana» (nunca se publica sin una validacion). */
export function bankStatusFor(v: ValidationStatus): 'approved' | 'human_review' {
  return v === 'validado' ? 'approved' : 'human_review';
}
