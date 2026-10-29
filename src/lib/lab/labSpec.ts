// Validacion de la FICHA DEL EXPERIMENTO (LabSpec). Es la barrera entre lo que genera la IA (o el profesor) y lo que ve un estudiante: nunca confia en el dato.
// Todo se recorta a los limites de la plantilla, el texto se limpia (solo texto, sin etiquetas) y lo que sobra o no existe se descarta con un aviso. Sin React ni red.

import { getLabTemplate } from './labTemplates';
import { sanitizeText } from './sanitize';
import { templateFromModel, validateModel } from './model';
import { MODEL_TEMPLATE_ID, type LabMode, type LabModel, type LabSpec, type LabTemplateInfo, type LabVariableOverride, type ResolvedLab } from './types';

export const LIMITS = {
  title: 120,
  objective: 400,
  context: 500,
  hypothesisPrompt: 200,
  question: 240,
  maxQuestions: 6,
  minQuestionLength: 8,
  minTrials: { min: 2, max: 12, default: 5 },
} as const;

export const DEFAULT_HYPOTHESIS_PROMPT = 'Antes de empezar: ¿qué crees que va a pasar y por qué?';

export { sanitizeText };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type SpecResult = { ok: true; spec: LabSpec; warnings: string[] } | { ok: false; errors: string[] };

// Una ficha por defecto: el experimento "de libro" de la plantilla.
export function defaultSpec(tpl: LabTemplateInfo): LabSpec {
  return {
    template: tpl.id,
    title: tpl.name,
    objective: tpl.concept,
    context: '',
    hypothesisPrompt: DEFAULT_HYPOTHESIS_PROMPT,
    independent: tpl.defaultIndependent,
    mode: 'controlado',
    variables: {},
    constants: {},
    minTrials: LIMITS.minTrials.default,
    showModelCurve: false,
    questions: [...tpl.defaultQuestions],
  };
}

export function validateLabSpec(raw: unknown): SpecResult {
  if (!isObj(raw)) return { ok: false, errors: ['La ficha del experimento debe ser un objeto.'] };
  const warnings: string[] = [];
  // Laboratorio a la medida: el modelo declarativo (validado numericamente) hace de plantilla.
  let model: LabModel | undefined;
  let tpl: LabTemplateInfo | undefined;
  if (raw.template === MODEL_TEMPLATE_ID) {
    const mv = validateModel(raw.model);
    if (!mv.ok) return { ok: false, errors: mv.errors };
    model = mv.model;
    warnings.push(...mv.warnings);
    tpl = templateFromModel(model);
  } else tpl = getLabTemplate(raw.template) ?? undefined;
  if (!tpl) return { ok: false, errors: [`La plantilla "${String(raw.template)}" no existe.`] };
  const base = defaultSpec(tpl);

  const title = sanitizeText(raw.title, LIMITS.title);
  const objective = sanitizeText(raw.objective, LIMITS.objective);
  const context = sanitizeText(raw.context, LIMITS.context);
  const hypothesisPrompt = sanitizeText(raw.hypothesisPrompt, LIMITS.hypothesisPrompt);

  // Variable independiente: debe ser una variable de la plantilla; si no, se usa la de siempre.
  let independent = base.independent;
  if (raw.independent !== undefined) {
    if (typeof raw.independent === 'string' && tpl.variables.some((v) => v.id === raw.independent)) independent = raw.independent;
    else warnings.push(`La variable independiente "${String(raw.independent)}" no existe en esta plantilla: se usó "${base.independent}".`);
  }

  const mode: LabMode = raw.mode === 'libre' ? 'libre' : 'controlado';

  // Rangos y valores por defecto de cada variable: recortados a los limites de la plantilla.
  const variables: Record<string, LabVariableOverride> = {};
  if (isObj(raw.variables)) {
    for (const [id, ov] of Object.entries(raw.variables)) {
      const def = tpl.variables.find((v) => v.id === id);
      if (!def) {
        warnings.push(`La variable "${id}" no existe en esta plantilla: se ignoró.`);
        continue;
      }
      if (!isObj(ov)) continue;
      const out: LabVariableOverride = {};
      const lo = num(ov.min);
      const hi = num(ov.max);
      if (lo !== null) out.min = clamp(lo, def.min, def.max);
      if (hi !== null) out.max = clamp(hi, def.min, def.max);
      if (out.min !== undefined && out.max !== undefined && out.min >= out.max) {
        warnings.push(`El rango de "${def.label}" no era válido: se usó el de la plantilla.`);
        delete out.min;
        delete out.max;
      }
      const d = num(ov.default);
      if (d !== null) out.default = clamp(d, out.min ?? def.min, out.max ?? def.max);
      if (Object.keys(out).length > 0) variables[id] = out;
    }
  }

  const constants: Record<string, number> = {};
  if (isObj(raw.constants)) {
    for (const [id, val] of Object.entries(raw.constants)) {
      const def = tpl.constants.find((c) => c.id === id);
      const n = num(val);
      if (!def || n === null) {
        warnings.push(`La constante "${id}" no existe o no es un número: se ignoró.`);
        continue;
      }
      constants[id] = clamp(n, def.min, def.max);
      if (constants[id] !== n) warnings.push(`"${def.label}" quedó fuera del rango permitido (${def.min} a ${def.max}): se ajustó.`);
    }
  }

  const mt = num(raw.minTrials);
  const minTrials = mt === null ? LIMITS.minTrials.default : clamp(Math.round(mt), LIMITS.minTrials.min, LIMITS.minTrials.max);

  // Preguntas guia: texto limpio, sin repetidas, con un largo minimo; si no queda ninguna, las de la plantilla.
  let questions: string[] = [];
  if (Array.isArray(raw.questions)) {
    const seen = new Set<string>();
    for (const q of raw.questions) {
      const t = sanitizeText(q, LIMITS.question);
      const key = t.toLowerCase();
      if (t.length < LIMITS.minQuestionLength || seen.has(key)) continue;
      seen.add(key);
      questions.push(t);
      if (questions.length === LIMITS.maxQuestions) break;
    }
    if (Array.isArray(raw.questions) && raw.questions.length > LIMITS.maxQuestions) warnings.push(`Solo se usan las primeras ${LIMITS.maxQuestions} preguntas.`);
  }
  if (questions.length === 0) questions = base.questions;

  return {
    ok: true,
    warnings,
    spec: {
      template: tpl.id,
      title: title.length >= 3 ? title : base.title,
      objective: objective.length >= 10 ? objective : base.objective,
      context,
      hypothesisPrompt: hypothesisPrompt.length >= 10 ? hypothesisPrompt : base.hypothesisPrompt,
      independent,
      mode,
      variables,
      constants,
      minTrials,
      showModelCurve: raw.showModelCurve === true,
      questions,
      ...(model ? { model } : {}),
    },
  };
}

// Combina la plantilla con la ficha (ya validada) y arma lo que recibe el laboratorio. En modo controlado, todas las variables menos la independiente quedan fijas.
// La plantilla de una ficha: la del catalogo, o la que sale de su modelo a la medida.
export function templateOfSpec(spec: Pick<LabSpec, 'template' | 'model'>): LabTemplateInfo | undefined {
  return spec.model ? templateFromModel(spec.model) : (getLabTemplate(spec.template) ?? undefined);
}

export function resolveLab(spec: LabSpec): ResolvedLab | null {
  const tpl = templateOfSpec(spec);
  if (!tpl) return null;
  const independent = tpl.variables.some((v) => v.id === spec.independent) ? spec.independent : tpl.defaultIndependent;

  const variables = tpl.variables.map((v) => {
    const ov = spec.variables[v.id] ?? {};
    const min = clamp(ov.min ?? v.min, v.min, v.max);
    const max = clamp(ov.max ?? v.max, v.min, v.max);
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    const isIndependent = v.id === independent;
    return {
      ...v,
      min: lo,
      max: hi,
      default: clamp(ov.default ?? v.default, lo, hi),
      role: isIndependent ? ('independiente' as const) : ('controlada' as const),
      locked: spec.mode === 'controlado' && !isIndependent,
    };
  });

  const constants = tpl.constants.map((c) => ({ id: c.id, label: c.label, unit: c.unit, decimals: c.decimals, value: clamp(spec.constants[c.id] ?? c.value, c.min, c.max) }));

  const xOk = variables.some((v) => v.id === tpl.defaultChart.x);
  return {
    template: tpl.id,
    title: spec.title,
    objective: spec.objective,
    context: spec.context,
    hypothesisPrompt: spec.hypothesisPrompt,
    mode: spec.mode,
    independent,
    minTrials: spec.minTrials,
    showModelCurve: spec.showModelCurve,
    questions: spec.questions.map((text, i) => ({ id: `q${i + 1}`, text })),
    variables,
    constants,
    outputs: tpl.outputs,
    // La grafica empieza con la variable independiente en el eje X.
    chart: { x: xOk ? independent : tpl.defaultChart.x, y: tpl.defaultChart.y },
    ...(spec.model ? { model: spec.model } : {}),
  };
}

// Atajo: ficha cruda -> laboratorio listo (o los errores).
export function buildLab(raw: unknown): { ok: true; lab: ResolvedLab; spec: LabSpec; warnings: string[] } | { ok: false; errors: string[] } {
  const v = validateLabSpec(raw);
  if (!v.ok) return v;
  const lab = resolveLab(v.spec);
  return lab ? { ok: true, lab, spec: v.spec, warnings: v.warnings } : { ok: false, errors: ['No se pudo armar el laboratorio.'] };
}
