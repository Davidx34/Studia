// Modelos declarativos de laboratorio: la IA (o el profesor) describe el experimento como DATOS y aqui se valida. Nada de lo que escribe la IA se ejecuta tal cual: las formulas
// las interpreta el evaluador propio (public/labs/expr.js, sin eval) y ANTES de mostrar el laboratorio se prueba numericamente en una rejilla de valores dentro de los rangos:
// si alguna salida da NaN o infinito en algun punto, el modelo se rechaza con el punto exacto donde falla (asi la IA puede corregirlo). Sin red ni React.

import { MSG_LIMITS } from './protocol';
import { LAB_AREA_LABEL, MODEL_TEMPLATE_ID, type LabArea, type LabConstantDef, type LabModel, type LabTemplateInfo, type LabVariableDef, type ModelCurve, type ModelOutput, type ModelScene, type ModelStep } from './types';
import { sanitizeText } from './sanitize';

export interface ExprApi {
  LIMITS: { chars: number; nodes: number; depth: number; name: number };
  FUNCTIONS: string[];
  PARAM: string;
  RESERVED: string[];
  parse(src: string): { ok: true; idents: string[] } | { ok: false; error: string };
  compile(src: string, allowed: string[]): { ok: true; fn: (env: Record<string, number>) => number } | { ok: false; error: string };
  compileModel(model: unknown): CompiledModel | { ok: false; errors: string[] };
}

export interface CompiledModel {
  ok: true;
  run(values: Record<string, number>, constants: Record<string, number>): Record<string, number>;
  outputIds: string[];
  param: string;
  scene: {
    xLabel: string;
    yLabel: string;
    curves: ({ kind: 'sweep'; label: string; dashed: boolean; output: string } | { kind: 'param'; label: string; dashed: boolean; x: Fn; y: Fn; from: Fn; to: Fn })[];
    points: { label: string; x: Fn; y: Fn }[];
  };
}
type Fn = (env: Record<string, number>) => number;

// El mismo archivo que usa el laboratorio dentro del iframe: una sola fuente de verdad para calcular.
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const Expr = require('../../../public/labs/expr.js') as ExprApi;

export const MODEL_LIMITS = {
  variables: 5,
  constants: 8,
  derived: 8,
  outputs: 6,
  curves: 4,
  points: 4,
  basis: 6,
  concept: 200,
  label: 60,
  unit: 16,
  // Un valor mas grande que esto en una salida se considera descontrolado.
  maxAbs: 1e9,
  // Pasos maximos de una variable ((max-min)/step).
  maxSteps: 10000,
  maxRange: 1e6,
  json: 14000,
  evals: 900,
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const AREAS = Object.keys(LAB_AREA_LABEL) as LabArea[];

function decimalsFor(step: number): number {
  for (let d = 0; d <= 4; d++) if (Math.abs(step * Math.pow(10, d) - Math.round(step * Math.pow(10, d))) < 1e-9) return d;
  return 4;
}

// Un punto donde una salida deja de ser un numero razonable (para poder corregirlo).
export interface ProbeFailure {
  output: string;
  values: Record<string, number>;
  constants: Record<string, number>;
}

export type ModelResult = { ok: true; model: LabModel; warnings: string[] } | { ok: false; errors: string[]; failures?: ProbeFailure[] };

const fmtN = (n: number) => String(Number(n.toPrecision(4)));

// Generador pseudoaleatorio determinista (LCG): la misma ficha siempre se prueba con los mismos puntos.
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function validateModel(raw: unknown): ModelResult {
  if (!isObj(raw)) return { ok: false, errors: ['El modelo debe ser un objeto con variables, salidas y fórmulas.'] };
  const errors: string[] = [];
  const warnings: string[] = [];

  // ───────── variables ─────────
  const rawVars = Array.isArray(raw.variables) ? raw.variables : [];
  if (rawVars.length < 1) errors.push('El modelo necesita al menos una variable que el estudiante pueda mover.');
  if (rawVars.length > MODEL_LIMITS.variables) errors.push(`Máximo ${MODEL_LIMITS.variables} variables.`);
  const variables: LabVariableDef[] = [];
  rawVars.slice(0, MODEL_LIMITS.variables).forEach((rv, i) => {
    if (!isObj(rv)) return void errors.push(`Variable ${i + 1}: formato inválido.`);
    const id = typeof rv.id === 'string' ? rv.id : '';
    const min = num(rv.min);
    const max = num(rv.max);
    if (min === null || max === null || min >= max) return void errors.push(`Variable "${id}": necesita min y max numéricos con min < max.`);
    if (Math.abs(min) > MODEL_LIMITS.maxRange || Math.abs(max) > MODEL_LIMITS.maxRange) return void errors.push(`Variable "${id}": el rango es demasiado grande (máximo ±${MODEL_LIMITS.maxRange}).`);
    let step = num(rv.step);
    if (step === null || step <= 0) step = Number(((max - min) / 100).toPrecision(2));
    if ((max - min) / step > MODEL_LIMITS.maxSteps) return void errors.push(`Variable "${id}": el paso es demasiado pequeño para su rango.`);
    const dRaw = num(rv.default);
    const def = dRaw === null ? (min + max) / 2 : clamp(dRaw, min, max);
    if (dRaw !== null && def !== dRaw) warnings.push(`El valor inicial de "${id}" estaba fuera de su rango: se ajustó.`);
    const dec = num(rv.decimals);
    variables.push({
      id,
      label: sanitizeText(rv.label, MODEL_LIMITS.label) || id,
      unit: sanitizeText(rv.unit, MODEL_LIMITS.unit),
      min,
      max,
      step,
      default: def,
      decimals: dec === null ? decimalsFor(step) : clamp(Math.round(dec), 0, 4),
    });
  });

  // ───────── constantes ─────────
  const rawConsts = Array.isArray(raw.constants) ? raw.constants : [];
  if (rawConsts.length > MODEL_LIMITS.constants) errors.push(`Máximo ${MODEL_LIMITS.constants} constantes.`);
  const constants: LabConstantDef[] = [];
  rawConsts.slice(0, MODEL_LIMITS.constants).forEach((rc, i) => {
    if (!isObj(rc)) return void errors.push(`Constante ${i + 1}: formato inválido.`);
    const id = typeof rc.id === 'string' ? rc.id : '';
    const value = num(rc.value);
    if (value === null || Math.abs(value) > MODEL_LIMITS.maxRange) return void errors.push(`Constante "${id}": necesita un valor numérico.`);
    let min = num(rc.min);
    let max = num(rc.max);
    if (min === null) min = Math.min(0, value);
    if (max === null) max = value === 0 ? 1 : Math.abs(value) * 10;
    if (min > value || max < value || min >= max) {
      warnings.push(`El rango de la constante "${id}" no incluía su valor: se ajustó.`);
      min = Math.min(min, value);
      max = Math.max(max, value, min + 1);
    }
    const dec = num(rc.decimals);
    constants.push({ id, label: sanitizeText(rc.label, MODEL_LIMITS.label) || id, unit: sanitizeText(rc.unit, MODEL_LIMITS.unit), value, min, max, decimals: dec === null ? 2 : clamp(Math.round(dec), 0, 4) });
  });

  // ───────── pasos y salidas ─────────
  const derived: ModelStep[] = [];
  const rawDer = Array.isArray(raw.derived) ? raw.derived : [];
  if (rawDer.length > MODEL_LIMITS.derived) errors.push(`Máximo ${MODEL_LIMITS.derived} pasos intermedios.`);
  rawDer.slice(0, MODEL_LIMITS.derived).forEach((rd, i) => {
    if (!isObj(rd) || typeof rd.id !== 'string' || typeof rd.expr !== 'string') return void errors.push(`Paso ${i + 1}: necesita id y expr.`);
    derived.push({ id: rd.id, expr: rd.expr });
  });
  const rawOut = Array.isArray(raw.outputs) ? raw.outputs : [];
  if (rawOut.length < 1) errors.push('El modelo necesita al menos una salida (lo que se mide).');
  if (rawOut.length > MODEL_LIMITS.outputs) errors.push(`Máximo ${MODEL_LIMITS.outputs} salidas.`);
  const outputs: ModelOutput[] = [];
  rawOut.slice(0, MODEL_LIMITS.outputs).forEach((ro, i) => {
    if (!isObj(ro) || typeof ro.id !== 'string' || typeof ro.expr !== 'string') return void errors.push(`Salida ${i + 1}: necesita id y expr.`);
    const dec = num(ro.decimals);
    outputs.push({ id: ro.id, expr: ro.expr, label: sanitizeText(ro.label, MODEL_LIMITS.label) || ro.id, unit: sanitizeText(ro.unit, MODEL_LIMITS.unit), decimals: dec === null ? 2 : clamp(Math.round(dec), 0, 4) });
  });

  // Los resultados de un ensayo viajan en un mensaje con tope de claves.
  if (variables.length > MSG_LIMITS.keys || outputs.length > MSG_LIMITS.keys) errors.push('Demasiadas variables o salidas.');
  for (const id of [...variables.map((v) => v.id), ...constants.map((c) => c.id), ...derived.map((d) => d.id), ...outputs.map((o) => o.id)]) {
    if (!Expr.RESERVED.includes(id) && !MSG_LIMITS.keyPattern.test(id)) errors.push(`El id "${id}" no es válido (letras y números, empieza por letra, máximo 24).`);
  }

  // ───────── independiente y gráfica ─────────
  let independent = variables[0]?.id ?? '';
  if (typeof raw.independent === 'string' && variables.some((v) => v.id === raw.independent)) independent = raw.independent;
  else if (raw.independent !== undefined && variables.length) warnings.push(`La variable independiente "${String(raw.independent)}" no existe: se usó "${independent}".`);
  const chartRaw = isObj(raw.chart) ? raw.chart : {};
  const chartY = typeof chartRaw.y === 'string' && outputs.some((o) => o.id === chartRaw.y) ? chartRaw.y : (outputs[0]?.id ?? '');
  const chartX = typeof chartRaw.x === 'string' && [...variables, ...outputs].some((v) => v.id === chartRaw.x) ? chartRaw.x : independent;

  // ───────── escena ─────────
  let scene: ModelScene | null = null;
  if (isObj(raw.scene)) {
    const sc = raw.scene;
    const curves: ModelCurve[] = [];
    (Array.isArray(sc.curves) ? sc.curves : []).slice(0, MODEL_LIMITS.curves).forEach((c, i) => {
      if (!isObj(c)) return void errors.push(`Curva ${i + 1}: formato inválido.`);
      const label = sanitizeText(c.label, MODEL_LIMITS.label);
      const dashed = c.dashed === true;
      if (c.kind === 'sweep' && typeof c.output === 'string') curves.push({ kind: 'sweep', label, dashed, output: c.output });
      else if (c.kind === 'param' && ['x', 'y', 'from', 'to'].every((k) => typeof c[k] === 'string')) curves.push({ kind: 'param', label, dashed, x: String(c.x), y: String(c.y), from: String(c.from), to: String(c.to) });
      else errors.push(`Curva ${i + 1}: usa kind "sweep" (con output) o "param" (con x, y, from, to).`);
    });
    const points = (Array.isArray(sc.points) ? sc.points : [])
      .slice(0, MODEL_LIMITS.points)
      .filter((p): p is Record<string, unknown> => isObj(p) && typeof p.x === 'string' && typeof p.y === 'string')
      .map((p) => ({ label: sanitizeText(p.label, MODEL_LIMITS.label), x: String(p.x), y: String(p.y) }));
    scene = { xLabel: sanitizeText(sc.xLabel, MODEL_LIMITS.label), yLabel: sanitizeText(sc.yLabel, MODEL_LIMITS.label), curves, points };
  }

  const basis = (Array.isArray(raw.basis) ? raw.basis : [])
    .map((b) => sanitizeText(b, 80))
    .filter((b) => b.length > 0)
    .slice(0, MODEL_LIMITS.basis);
  const areaRaw = typeof raw.area === 'string' ? raw.area : '';
  const area: LabArea = (AREAS as string[]).includes(areaRaw) ? (areaRaw as LabArea) : 'matematicas';

  const model: LabModel = { area, concept: sanitizeText(raw.concept, MODEL_LIMITS.concept), variables, constants, derived, outputs, independent, chart: { x: chartX, y: chartY }, scene, basis };
  if (errors.length) return { ok: false, errors };
  if (JSON.stringify(model).length > MODEL_LIMITS.json) return { ok: false, errors: ['El modelo es demasiado grande.'] };

  // ───────── formulas: parseo y nombres ─────────
  const compiled = Expr.compileModel({ variables, constants, derived, outputs, scene });
  if (!compiled.ok) return { ok: false, errors: compiled.errors };

  // ───────── coherencia: todo lo declarado debe servir ─────────
  const lints = lint(model);
  if (lints.length) return { ok: false, errors: lints };

  // ───────── prueba numerica ─────────
  const probed = probe(model, compiled);
  if (probed.errors.length) return { ok: false, errors: probed.errors, ...(probed.failures.length ? { failures: probed.failures } : {}) };
  const flat = sensitivity(model, compiled);
  if (flat) return { ok: false, errors: [flat] };
  return { ok: true, model, warnings };
}

// Coherencia: una variable, constante o paso que no influye en NINGUNA salida es una señal de que el modelo menciona algo (por ejemplo un presupuesto) pero no lo impone.
// Sin este control un modelo puede ser numericamente valido y, aun asi, no representar la materia.
function lint(model: LabModel): string[] {
  const deps: Record<string, string[]> = Object.create(null);
  [...model.derived, ...model.outputs].forEach((d) => {
    const p = Expr.parse(d.expr);
    deps[d.id] = p.ok ? p.idents : [];
  });
  const used: Record<string, true> = Object.create(null);
  const stack = model.outputs.map((o) => o.id);
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (used[id]) continue;
    used[id] = true;
    (deps[id] ?? []).forEach((n) => stack.push(n));
  }
  const errs: string[] = [];
  const hint = ' Todo lo que declaras debe afectar lo que se mide: si es una restricción (un presupuesto, una conservación...), el modelo debe IMPONERLA con una fórmula (por ejemplo calcular una cantidad a partir de ella) y no solo mencionarla.';
  model.variables.forEach((v) => {
    if (!used[v.id]) errs.push(`La variable "${v.id}" no influye en ninguna salida.${hint}`);
  });
  model.constants.forEach((c) => {
    if (!used[c.id]) errs.push(`La constante "${c.id}" no influye en ninguna salida.${hint}`);
  });
  model.derived.forEach((d) => {
    if (!used[d.id]) errs.push(`El paso "${d.id}" no se usa en ninguna salida: quítalo o úsalo en una salida.`);
  });
  return errs;
}

// La salida de la grafica debe RESPONDER a la variable independiente (si no, el estudiante no ve ningun efecto al moverla).
function sensitivity(model: LabModel, c: CompiledModel): string | null {
  const ind = model.variables.find((v) => v.id === model.independent);
  if (!ind) return null;
  const k: Record<string, number> = {};
  model.constants.forEach((x) => (k[x.id] = x.value));
  const base: Record<string, number> = {};
  model.variables.forEach((v) => (base[v.id] = v.default));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const v = { ...base, [ind.id]: ind.min + ((ind.max - ind.min) * i) / 20 };
    const y = c.run(v, k)[model.chart.y];
    if (!Number.isFinite(y)) continue;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  if (hi - lo <= 1e-9 * (1 + Math.abs(hi))) return `La salida "${model.chart.y}" no cambia cuando mueves "${ind.id}": el estudiante no vería ningún efecto. Haz que "${model.chart.y}" dependa de "${ind.id}".`;
  return null;
}

// Puntos de prueba: las esquinas y el medio de los rangos (con las constantes en su valor, en su minimo y en su maximo) y puntos pseudoaleatorios fijos.
function probe(model: LabModel, c: CompiledModel): { errors: string[]; failures: ProbeFailure[] } {
  const vars = model.variables;
  const consts = model.constants;
  const samples: { v: Record<string, number>; k: Record<string, number> }[] = [];
  const base: Record<string, number> = {};
  consts.forEach((k) => (base[k.id] = k.value));
  const levels = (v: LabVariableDef) => [v.min, (v.min + v.max) / 2, v.max, v.default];

  const combos = (i: number, acc: Record<string, number>, push: (v: Record<string, number>) => void) => {
    if (i === vars.length) return push({ ...acc });
    for (const x of levels(vars[i])) {
      acc[vars[i].id] = x;
      combos(i + 1, acc, push);
    }
  };
  const constSets: Record<string, number>[] = [base, {}, {}];
  consts.forEach((k) => {
    constSets[1][k.id] = k.min;
    constSets[2][k.id] = k.max;
  });
  const grid: Record<string, number>[] = [];
  combos(0, {}, (v) => grid.push(v));
  // La rejilla completa solo con las constantes base; con minimo/maximo, solo las esquinas.
  grid.forEach((v) => samples.push({ v, k: base }));
  if (consts.length) {
    const corners = grid.filter((v) => vars.every((x) => v[x.id] === x.min || v[x.id] === x.max));
    corners.forEach((v) => {
      samples.push({ v, k: constSets[1] });
      samples.push({ v, k: constSets[2] });
    });
  }
  const rand = rng(12345);
  for (let i = 0; i < 60; i++) {
    const v: Record<string, number> = {};
    vars.forEach((x) => (v[x.id] = x.min + rand() * (x.max - x.min)));
    const k: Record<string, number> = {};
    consts.forEach((x) => (k[x.id] = x.min + rand() * (x.max - x.min)));
    samples.push({ v, k });
  }

  const bad: Record<string, string> = {};
  const failures: ProbeFailure[] = [];
  const exprOf: Record<string, string> = {};
  model.outputs.forEach((o) => (exprOf[o.id] = o.expr));
  for (const s of samples.slice(0, MODEL_LIMITS.evals)) {
    let env: Record<string, number>;
    try {
      env = c.run(s.v, s.k);
    } catch {
      return { errors: ['El modelo no se pudo evaluar.'], failures: [] };
    }
    for (const id of c.outputIds) {
      const y = env[id];
      if (typeof y === 'number' && Number.isFinite(y) && Math.abs(y) <= MODEL_LIMITS.maxAbs) continue;
      if (bad[id]) continue;
      const at = vars.map((x) => `${x.id} = ${fmtN(s.v[x.id])}`).join(', ');
      const ct = consts.length ? ` (constantes: ${consts.map((x) => `${x.id} = ${fmtN(s.k[x.id])}`).join(', ')})` : '';
      bad[id] = `La salida "${id}" (fórmula: ${exprOf[id]}) no es un número razonable (${Number.isNaN(y) ? 'NaN' : String(y)}) cuando ${at}${ct}. Ajusta los rangos o protege la fórmula (por ejemplo con max(...) o if(...)).`;
      failures.push({ output: id, values: { ...s.v }, constants: { ...s.k } });
    }
  }
  const out = Object.keys(bad).map((k) => bad[k]);
  if (out.length) return { errors: out, failures };

  // La escena, en el punto inicial: los puntos deben existir y cada curva debe dibujar algo.
  const v0: Record<string, number> = {};
  vars.forEach((x) => (v0[x.id] = x.default));
  const env0 = c.run(v0, base);
  const errs: string[] = [];
  c.scene.points.forEach((p, i) => {
    const px = p.x(env0);
    const py = p.y(env0);
    if (!Number.isFinite(px) || !Number.isFinite(py)) errs.push(`El punto ${i + 1} de la escena no es un número con los valores iniciales.`);
  });
  c.scene.curves.forEach((cv, i) => {
    if (cv.kind === 'sweep') return;
    const a = cv.from(env0);
    const b = cv.to(env0);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(a < b)) return void errs.push(`La curva ${i + 1} de la escena necesita from < to (con los valores iniciales dan ${fmtN(a)} y ${fmtN(b)}).`);
    let ok = 0;
    for (let j = 0; j <= 40; j++) {
      const e = Object.assign(Object.create(null), env0);
      e[c.param] = a + ((b - a) * j) / 40;
      if (Number.isFinite(cv.x(e)) && Number.isFinite(cv.y(e))) ok++;
    }
    if (ok < 2) errs.push(`La curva ${i + 1} de la escena no dibuja nada con los valores iniciales.`);
  });
  return { errors: errs, failures: [] };
}

// Calcula las salidas de un modelo (para pruebas y para la vista previa en el servidor).
export function evaluateModel(model: LabModel, values: Record<string, number>, constants: Record<string, number>): Record<string, number> {
  const c = Expr.compileModel({ variables: model.variables, constants: model.constants, derived: model.derived, outputs: model.outputs, scene: model.scene });
  if (!c.ok) throw new Error(c.errors.join(' '));
  const env = c.run(values, constants);
  const out: Record<string, number> = {};
  c.outputIds.forEach((id) => (out[id] = env[id]));
  return out;
}

const AREA_NAME = LAB_AREA_LABEL;

// El modelo visto como una "plantilla" del catalogo: asi la validacion de la ficha y el laboratorio genérico usan el mismo camino que las plantillas fijas.
export function templateFromModel(model: LabModel): LabTemplateInfo {
  const yOut = model.outputs.find((o) => o.id === model.chart.y) ?? model.outputs[0];
  const xVar = model.variables.find((v) => v.id === model.independent) ?? model.variables[0];
  return {
    id: MODEL_TEMPLATE_ID,
    name: 'Modelo a la medida',
    area: model.area,
    concept: model.concept || `Explora cómo cambia ${yOut?.label ?? 'el resultado'} al variar ${xVar?.label ?? 'una variable'}.`,
    description: `Modelo diseñado para esta clase (${AREA_NAME[model.area]}).`,
    bestFor: 'Este experimento en particular.',
    variables: model.variables,
    constants: model.constants,
    outputs: model.outputs.map((o) => ({ id: o.id, label: o.label, unit: o.unit, decimals: o.decimals })),
    defaultIndependent: model.independent,
    defaultChart: model.chart,
    defaultQuestions: [
      `¿Cómo cambia ${yOut?.label ?? 'el resultado'} cuando varías ${xVar?.label ?? 'la variable'}? Apóyate en tu tabla de datos.`,
      `¿Para qué valor de ${xVar?.label ?? 'la variable'} obtienes el mejor resultado y cómo lo sabes?`,
    ],
  };
}
