// Ayudantes del editor de la ficha del experimento (sin React, para poder probarlos). El formulario trabaja con una ficha "en borrador" que puede estar a medias; lo que se
// previsualiza y se guarda siempre es la version VALIDADA (validateLabSpec), asi nada fuera de los limites de la plantilla llega a un estudiante.

import { LIMITS, buildLab, validateLabSpec } from './labSpec';
import { getLabTemplate } from './labTemplates';
import type { LabMode, LabSpec, LabVariableOverride, ResolvedLab } from './types';

export function withVariable(spec: LabSpec, id: string, patch: LabVariableOverride): LabSpec {
  return { ...spec, variables: { ...spec.variables, [id]: { ...spec.variables[id], ...patch } } };
}

export function withConstant(spec: LabSpec, id: string, value: number): LabSpec {
  return { ...spec, constants: { ...spec.constants, [id]: value } };
}

export function withIndependent(spec: LabSpec, id: string): LabSpec {
  return { ...spec, independent: id };
}

export function withMode(spec: LabSpec, mode: LabMode): LabSpec {
  return { ...spec, mode };
}

// Error de una pregunta guia, o null si esta bien. (Una pregunta muy corta no se guarda: el validador la descartaria.)
export function questionError(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length === 0) return null; // vacia: simplemente se quita
  if (t.length < LIMITS.minQuestionLength) return `Escribe al menos ${LIMITS.minQuestionLength} caracteres.`;
  if (t.length > LIMITS.question) return `Máximo ${LIMITS.question} caracteres.`;
  return null;
}

// Las preguntas del formulario -> la lista que se guarda (sin vacias, hasta el maximo).
export function cleanQuestions(list: string[]): string[] {
  return list.map((q) => q.replace(/\s+/g, ' ').trim()).filter((q) => q.length > 0).slice(0, LIMITS.maxQuestions);
}

// Valor efectivo de una variable en la ficha (con los recortes ya aplicados): lo que el formulario debe mostrar tras salir del campo.
export function effectiveVariable(spec: LabSpec, id: string): { min: number; max: number; default: number } | null {
  const built = buildLab(spec);
  if (!built.ok) return null;
  const v = built.lab.variables.find((x) => x.id === id);
  return v ? { min: v.min, max: v.max, default: v.default } : null;
}

// La ficha ya validada y los avisos de lo que se ajusto; null si no se puede validar (plantilla inexistente).
export function normalizeDraft(spec: LabSpec): { spec: LabSpec; warnings: string[]; lab: ResolvedLab } | null {
  const v = validateLabSpec(spec);
  if (!v.ok) return null;
  const b = buildLab(v.spec);
  return b.ok ? { spec: v.spec, warnings: v.warnings, lab: b.lab } : null;
}

// Una pista del limite de cada variable para el formulario ("de 1 a 60 m/s").
export function limitHint(templateId: string, variableId: string): string {
  const t = getLabTemplate(templateId);
  const v = t?.variables.find((x) => x.id === variableId);
  if (!v) return '';
  return `Límite de la plantilla: de ${String(v.min).replace('.', ',')} a ${String(v.max).replace('.', ',')}${v.unit ? ' ' + v.unit : ''}`;
}
