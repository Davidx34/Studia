// Protocolo de mensajes entre la app y el laboratorio (el iframe). El laboratorio corre AISLADO (sandbox sin allow-same-origin): no puede leer la sesion, las cookies ni
// el resto de la app. La unica via es postMessage, y la app trata todo lo que llega como NO CONFIABLE: se valida la forma y se acotan los tamaños antes de guardar o mostrar.
// Sin React, para poder probarlo.

import type { LabAttemptState, LabTrial, ResolvedLab } from './types';

export const HOST_SOURCE = 'studia-host';
export const LAB_SOURCE = 'studia-lab';

export const MSG_LIMITS = {
  trials: 60,
  answers: 6,
  text: 2000,
  keys: 12,
  keyPattern: /^[A-Za-z][A-Za-z0-9_]{0,23}$/,
  maxAbs: 1e12,
  height: { min: 200, max: 6000 },
} as const;

// De la app al laboratorio.
export interface InitMessage {
  source: typeof HOST_SOURCE;
  type: 'init';
  lab: ResolvedLab;
  state: LabAttemptState | null;
  // Solo lectura: el profesor revisa un informe, o el estudiante ya lo entrego.
  readOnly: boolean;
  // Colores del tema de la app (--lab-*), para que el laboratorio se vea igual en claro u oscuro.
  theme: Record<string, string>;
}

// Del laboratorio a la app.
export type LabMessage =
  | { source: typeof LAB_SOURCE; type: 'ready'; template: string }
  | { source: typeof LAB_SOURCE; type: 'state'; state: LabAttemptState }
  | { source: typeof LAB_SOURCE; type: 'submit'; state: LabAttemptState }
  | { source: typeof LAB_SOURCE; type: 'resize'; height: number };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function text(v: unknown, max: number = MSG_LIMITS.text): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '';
}

// Solo numeros finitos y acotados; el resto se descarta.
function record(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  const entries = Object.entries(v);
  if (entries.length > MSG_LIMITS.keys) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of entries) {
    if (!MSG_LIMITS.keyPattern.test(k)) return null;
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > MSG_LIMITS.maxAbs) return null;
    out[k] = n;
  }
  return out;
}

function trial(v: unknown, i: number): LabTrial | null {
  if (!isObj(v)) return null;
  const inputs = record(v.inputs);
  const outputs = record(v.outputs);
  if (!inputs || !outputs) return null;
  return { n: i + 1, control: v.control === true, inputs, outputs };
}

// null si el estado no tiene la forma esperada.
export function parseAttemptState(v: unknown): LabAttemptState | null {
  if (!isObj(v)) return null;
  if (!Array.isArray(v.trials) || v.trials.length > MSG_LIMITS.trials) return null;
  const trials: LabTrial[] = [];
  for (let i = 0; i < v.trials.length; i++) {
    const t = trial(v.trials[i], i);
    if (!t) return null;
    trials.push(t);
  }
  const rawAnswers = Array.isArray(v.answers) ? v.answers.slice(0, MSG_LIMITS.answers) : [];
  return {
    hypothesis: text(v.hypothesis),
    trials,
    answers: rawAnswers.map((a) => text(a)),
    conclusion: text(v.conclusion),
  };
}

// Valida un mensaje que llego del iframe. null = descartarlo.
export function parseLabMessage(data: unknown): LabMessage | null {
  if (!isObj(data) || data.source !== LAB_SOURCE) return null;
  switch (data.type) {
    case 'ready':
      return typeof data.template === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(data.template) ? { source: LAB_SOURCE, type: 'ready', template: data.template } : null;
    case 'state':
    case 'submit': {
      const state = parseAttemptState(data.state);
      return state ? { source: LAB_SOURCE, type: data.type, state } : null;
    }
    case 'resize': {
      const h = data.height;
      if (typeof h !== 'number' || !Number.isFinite(h)) return null;
      return { source: LAB_SOURCE, type: 'resize', height: Math.round(Math.min(MSG_LIMITS.height.max, Math.max(MSG_LIMITS.height.min, h))) };
    }
    default:
      return null;
  }
}

export function buildInitMessage(lab: ResolvedLab, state: LabAttemptState | null, readOnly: boolean, theme: Record<string, string>): InitMessage {
  return { source: HOST_SOURCE, type: 'init', lab, state, readOnly, theme };
}
