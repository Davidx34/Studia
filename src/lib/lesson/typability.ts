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
  // El calificador (cliente y servidor) exige que aparezcan TODAS las respuestas de la lista: una lista de sinonimos («uno», «1») o mas respuestas que huecos hace la pregunta IMPOSIBLE de acertar de forma
  // natural. Hallado por la revision externa (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §13): debe haber exactamente una respuesta por hueco («___»). Sin ningun hueco marcado no se aplica.
  const blanks = (q.match(/_{2,}/g) ?? []).length;
  if (blanks > 0 && list.length !== blanks) return { ok: false, error: `Hay ${blanks} hueco(s) y ${list.length} respuesta(s): el calificador exige todas las respuestas, asi que debe haber una por hueco.` };
  return { ok: true };
}

// Respuesta corta: entre 1 y 5 palabras clave, todas escribibles y ninguna regalada por el enunciado.
export function shortAnswerQuality(q: string, keywords: unknown): QualityResult {
  const list = Array.isArray(keywords) ? keywords : [];
  if (list.length === 0 || list.length > 5) return { ok: false, error: 'Una respuesta corta lleva de 1 a 5 palabras clave.' };
  const bad = unfairKeywords(q, list);
  if (bad.length > 0) return { ok: false, error: `Palabra clave no escribible o ya presente en el enunciado: ${JSON.stringify(bad[0]).slice(0, 60)}.` };
  // Si el enunciado pide «dos», «tres»... cosas, debe haber tantas palabras clave: el calificador exige TODAS, asi que «Indica dos de...» con tres palabras clave marca mal a quien da dos correctas.
  const asked = askedCount(q);
  if (asked !== null && asked !== list.length) return { ok: false, error: `El enunciado pide ${asked} elemento(s) pero hay ${list.length} palabra(s) clave y el calificador exige todas.` };
  return { ok: true };
}

const NUMBER_WORDS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5 };
// «Menciona los tres...», «Indica dos de...», «Nombra cuatro...»: cuantos elementos pide el enunciado (null si no pide una cantidad explicita, o si dice «una de» / «al menos», donde basta una parte).
export function askedCount(q: string): number | null {
  const text = q.toLowerCase();
  if (/\b(una|uno) de\b|al menos|como minimo|como mínimo/.test(text)) return null;
  const m = text.match(/\b(menciona|indica|nombra|enumera|cita|escribe|da|di|senala|señala|identifica)\b[^.?:;]{0,40}?\b(dos|tres|cuatro|cinco)\b/);
  return m ? NUMBER_WORDS[m[2]] : null;
}

const normPair = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Emparejar: un termino repetido (con definiciones distintas) no se puede distinguir. OJO: definiciones identicas NO se rechazan: el calificador compara el TEXTO de la definicion elegida, asi que con dos
// definiciones iguales cualquier asignacion es valida y no perjudica al estudiante (medido en el banco: 3 preguntas legitimas, p. ej. dos alimentos con el mismo origen).
export function matchQuality(pairs: unknown): QualityResult {
  const list = Array.isArray(pairs) ? (pairs as { term?: unknown; def?: unknown }[]) : [];
  const terms = list.map((p) => normPair(p?.term));
  if (new Set(terms).size !== terms.length) return { ok: false, error: 'Hay terminos repetidos en el emparejamiento.' };
  return { ok: true };
}
