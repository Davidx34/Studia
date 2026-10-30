// Validacion en el SERVIDOR de la entrega (informe) de un laboratorio. Todo lo que manda el navegador es no confiable: el estudiante puede abrir la consola y editar la tabla de ensayos,
// el estado que el laboratorio manda por postMessage, o llamar a la API directamente. Aqui se comprueba lo que el laboratorio ya pedia en pantalla y, sobre todo, se COMPRUEBA LA
// COHERENCIA NUMERICA: cada ensayo se vuelve a calcular con el mismo modelo (public/labs/expr.js o los modelos de las plantillas) y tiene que dar lo que el estudiante reporta. Asi una
// tabla inventada o retocada a mano no pasa. Sin red ni base de datos: funcion pura (el calculo se puede inyectar para probar).
//
// Lo que se exige:
//   - hipotesis de al menos 10 caracteres y conclusion de al menos 20 (los mismos minimos que la base);
//   - al menos `minTrials` ensayos (y no mas de los que admite el protocolo), numerados 1..n;
//   - el PRIMER ensayo es el de control (la linea base);
//   - una respuesta (de al menos 3 caracteres) a cada pregunta guia;
//   - cada ensayo trae exactamente las variables y salidas del laboratorio, con las variables dentro de su rango y, en modo controlado, las bloqueadas en su valor fijo;
//   - las salidas de cada ensayo coinciden con las que da el modelo para esas entradas.

import { Expr } from './model';
import { MSG_LIMITS } from './protocol';
import { REVIEW_LIMITS } from './reviewLimits';
import type { LabAttemptState, LabTrial, ResolvedLab } from './types';

export const SUBMISSION_LIMITS = {
  hypothesisMin: 10,
  conclusionMin: 20,
  textMax: MSG_LIMITS.text,
  answerMin: 3,
  // Tolerancia al comparar lo reportado con lo recalculado: relativa y absoluta. Cubre diferencias de redondeo entre navegadores, no retoques a mano.
  tolRel: 1e-6,
  tolAbs: 1e-9,
  // Cuantos errores se listan como maximo (para no devolver un texto enorme).
  maxErrors: 8,
} as const;

export type Compute = (lab: ResolvedLab, inputs: Record<string, number>) => Record<string, number> | null;

// Las plantillas fijas se cargan por nombre desde una lista cerrada (nunca una ruta armada con texto del cliente).
const FIXED_MODELS: Record<string, () => { model: (v: Record<string, number>, c: Record<string, number>) => Record<string, number> }> = {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  multiplicador: () => require('../../../public/labs/models/multiplicador.js'),
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  trayectoria: () => require('../../../public/labs/models/trayectoria.js'),
};

function constantsOf(lab: ResolvedLab): Record<string, number> {
  const c: Record<string, number> = {};
  lab.constants.forEach((k) => (c[k.id] = k.value));
  return c;
}

// El mismo calculo que hace el laboratorio en el navegador. Lo que no es un numero finito cuenta como 0 (igual que el laboratorio). null si el laboratorio no se puede calcular.
export const computeOutputs: Compute = (lab, inputs) => {
  let raw: Record<string, number> | undefined;
  try {
    if (lab.model) {
      const c = Expr.compileModel({ variables: lab.model.variables, constants: lab.model.constants, derived: lab.model.derived, outputs: lab.model.outputs });
      if (!c.ok) return null;
      raw = c.run(inputs, constantsOf(lab));
    } else {
      const load = FIXED_MODELS[lab.template];
      if (!load) return null;
      raw = load().model(inputs, constantsOf(lab));
    }
  } catch {
    return null;
  }
  const out: Record<string, number> = {};
  lab.outputs.forEach((o) => {
    const v = raw ? raw[o.id] : undefined;
    out[o.id] = typeof v === 'number' && isFinite(v) ? v : 0;
  });
  return out;
};

const close = (a: number, b: number) => Math.abs(a - b) <= SUBMISSION_LIMITS.tolAbs + SUBMISSION_LIMITS.tolRel * Math.max(Math.abs(a), Math.abs(b));

function sameKeys(obj: Record<string, number>, ids: string[]): boolean {
  const keys = Object.keys(obj);
  return keys.length === ids.length && ids.every((id) => Object.prototype.hasOwnProperty.call(obj, id));
}

export type SubmissionResult = { ok: true; clean: LabAttemptState } | { ok: false; errors: string[] };

export function validateSubmission(lab: ResolvedLab, state: LabAttemptState, compute: Compute = computeOutputs): SubmissionResult {
  const errors: string[] = [];
  const add = (m: string) => {
    if (errors.length < SUBMISSION_LIMITS.maxErrors) errors.push(m);
  };

  const hypothesis = (state.hypothesis ?? '').trim();
  const conclusion = (state.conclusion ?? '').trim();
  if (hypothesis.length < SUBMISSION_LIMITS.hypothesisMin) add(`Escribe tu hipótesis (al menos ${SUBMISSION_LIMITS.hypothesisMin} caracteres).`);
  if (conclusion.length < SUBMISSION_LIMITS.conclusionMin) add(`Escribe tu conclusión (al menos ${SUBMISSION_LIMITS.conclusionMin} caracteres).`);
  if (hypothesis.length > SUBMISSION_LIMITS.textMax || conclusion.length > SUBMISSION_LIMITS.textMax) add('La hipótesis o la conclusión es demasiado larga.');

  // Preguntas guia: una respuesta por pregunta.
  const answers = Array.isArray(state.answers) ? state.answers.map((a) => (typeof a === 'string' ? a.trim() : '')) : [];
  lab.questions.forEach((q, i) => {
    if ((answers[i] ?? '').length < SUBMISSION_LIMITS.answerMin) add(`Responde la pregunta ${i + 1}.`);
  });

  // Ensayos.
  const trials = Array.isArray(state.trials) ? state.trials : [];
  if (trials.length < lab.minTrials) add(`Te faltan ${lab.minTrials - trials.length} ensayo(s): necesitas al menos ${lab.minTrials}.`);
  if (trials.length > MSG_LIMITS.trials) add(`Hay demasiados ensayos (máximo ${MSG_LIMITS.trials}).`);
  if (trials.length > 0 && trials[0].control !== true) add('El primer ensayo debe ser el ensayo de control (la línea base).');

  const varIds = lab.variables.map((v) => v.id);
  const outIds = lab.outputs.map((o) => o.id);
  const checked = Math.min(trials.length, MSG_LIMITS.trials);
  for (let i = 0; i < checked; i++) {
    const t: LabTrial = trials[i];
    const where = `Ensayo ${i + 1}`;
    if (t.n !== i + 1) add(`${where}: la numeración no es correcta.`);
    if (!sameKeys(t.inputs, varIds)) {
      add(`${where}: no trae exactamente las variables del laboratorio.`);
      continue;
    }
    if (!sameKeys(t.outputs, outIds)) {
      add(`${where}: no trae exactamente los resultados del laboratorio.`);
      continue;
    }
    let inputsOk = true;
    for (const v of lab.variables) {
      const x = t.inputs[v.id];
      const slack = 1e-9 * Math.max(1, Math.abs(v.min), Math.abs(v.max));
      if (!Number.isFinite(x) || x < v.min - slack || x > v.max + slack) {
        add(`${where}: «${v.label}» está fuera de su rango (${v.min} a ${v.max}).`);
        inputsOk = false;
      } else if (v.locked && !close(x, v.default)) {
        add(`${where}: «${v.label}» debía quedar fija en ${v.default} (experimento controlado).`);
        inputsOk = false;
      }
    }
    if (!inputsOk) continue;
    // Coherencia numerica: lo reportado tiene que ser lo que da el modelo.
    const expected = compute(lab, t.inputs);
    if (!expected) {
      add('No se pudo comprobar el laboratorio en el servidor.');
      break;
    }
    for (const o of lab.outputs) {
      const got = t.outputs[o.id];
      if (!Number.isFinite(got) || !close(got, expected[o.id])) {
        add(`${where}: el resultado «${o.label}» no coincide con lo que calcula el modelo para esos valores.`);
        break;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    clean: {
      hypothesis,
      conclusion,
      answers: lab.questions.map((_, i) => answers[i] ?? ''),
      trials: trials.map((t, i) => ({ n: i + 1, control: t.control === true, inputs: { ...t.inputs }, outputs: { ...t.outputs } })),
    },
  };
}

// La revision del profesor: nota de 0 a 100 (con dos decimales como maximo) y un comentario opcional.
export { REVIEW_LIMITS };

export function parseReview(body: unknown): { ok: true; score: number; feedback: string | null } | { ok: false; error: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!b) return { ok: false, error: 'Petición inválida.' };
  const score = b.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return { ok: false, error: 'La nota debe ser un número de 0 a 100.' };
  let feedback: string | null = null;
  if (b.feedback !== undefined && b.feedback !== null) {
    if (typeof b.feedback !== 'string') return { ok: false, error: 'El comentario debe ser texto.' };
    const clean = b.feedback.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (clean.length > REVIEW_LIMITS.feedbackMax) return { ok: false, error: `El comentario es demasiado largo (máximo ${REVIEW_LIMITS.feedbackMax} caracteres).` };
    feedback = clean.length > 0 ? clean : null;
  }
  return { ok: true, score: Math.round(score * 100) / 100, feedback };
}
