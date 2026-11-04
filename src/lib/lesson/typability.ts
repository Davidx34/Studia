// Reglas de calidad que el estudiante SI nota, para preguntas de completar y de respuesta corta de las lecciones. Codigo puro.
//
// Medido con preguntas reales de una clase de Microeconomia (2026-11-04), el estudiante recibio:
//   - «La restriccion presupuestaria se define como _____, donde  y  son las cantidades...» con la respuesta `pxx + pyy ≤ W`: los simbolos de la formula se perdieron al leer el PDF (quedaron
//     espacios dobles) y la respuesta es IMPOSIBLE de teclear (≤);
//   - una respuesta corta con palabras clave «restriccion presupuestaria», «precio» (ya estaban en el enunciado) y «desplazamiento» (una respuesta correcta como «se desplaza hacia adentro» no
//     la cumplia).
// Estas funciones dicen cuando una pregunta no se puede contestar o no es justa. isValidQuestion las aplica (asi no se generan y las que ya existen dejan de servirse).

import { containsExpected } from './normalize';

// Lo que un estudiante puede ESCRIBIR en un teclado normal como respuesta: letras (con tildes y ñ), numeros y unos pocos signos de palabra. Sin simbolos matematicos (≤ ≥ < > = + * / ^ _ { }),
// sin LaTeX ($ \) y sin parentesis o corchetes. Maximo 6 palabras y 60 caracteres: se compara por texto, no por significado.
export const MAX_ANSWER_WORDS = 6;
export const MAX_ANSWER_CHARS = 60;
const TYPABLE = /^[\p{L}\p{N}][\p{L}\p{N} .,'’%-]*$/u;

export function isTypable(answer: unknown): boolean {
  if (typeof answer !== 'string') return false;
  const t = answer.trim();
  if (t.length === 0 || t.length > MAX_ANSWER_CHARS) return false;
  if (t.split(/\s+/).length > MAX_ANSWER_WORDS) return false;
  return TYPABLE.test(t);
}

// Huecos que deja una formula perdida al extraer el texto de un PDF: palabras separadas por DOS o mas espacios («donde  y  son»), parentesis vacios, signos de dolar vacios o una coma suelta.
const GAPS = [/[\p{L}\p{N},;:)]\s{2,}[\p{L}\p{N}(]/u, /\(\s*\)/, /\$\s*\$/, /\s,\s/, /\s{2,}[,.;:]/];

export function hasDroppedSymbols(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  return GAPS.some((re) => re.test(text));
}

// Una palabra clave es JUSTA si no esta ya en el enunciado (regalada) y se puede teclear.
export function unfairKeywords(question: string, keywords: readonly unknown[]): string[] {
  return keywords.filter((k): k is string => typeof k === 'string').filter((k) => !isTypable(k) || containsExpected(question, k));
}

export interface QualityResult {
  ok: boolean;
  error?: string;
}

// Completar: cada respuesta se puede teclear y no esta ya escrita en el enunciado.
export function fillBlankQuality(q: string, answers: unknown): QualityResult {
  const list = Array.isArray(answers) ? answers : [];
  const bad = list.filter((a) => !isTypable(a));
  if (bad.length > 0) return { ok: false, error: `La respuesta esperada no se puede escribir con el teclado (simbolos, formulas o demasiado larga): ${JSON.stringify(bad[0]).slice(0, 60)}.` };
  const leaked = list.find((a) => typeof a === 'string' && containsExpected(q, a));
  if (leaked !== undefined) return { ok: false, error: 'La respuesta ya esta escrita en el enunciado.' };
  return { ok: true };
}

// Respuesta corta: entre 1 y 5 palabras clave, todas escribibles y ninguna regalada por el enunciado.
export function shortAnswerQuality(q: string, keywords: unknown): QualityResult {
  const list = Array.isArray(keywords) ? keywords : [];
  if (list.length === 0 || list.length > 5) return { ok: false, error: 'Una respuesta corta lleva de 1 a 5 palabras clave.' };
  const bad = unfairKeywords(q, list);
  if (bad.length > 0) return { ok: false, error: `Palabra clave no escribible o ya presente en el enunciado: ${JSON.stringify(bad[0]).slice(0, 60)}.` };
  return { ok: true };
}
