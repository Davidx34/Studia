// Una PREGUNTA DE EXAMEN: la que la IA escribe para medir una comprension final (decision 1B) y la que el estudiante ve al terminar con su explicacion (decision 3D). Codigo puro.
//
// Cada pregunta nace ATADA a tres cosas, y sin ellas no entra al banco:
//   1. la COMPRENSION FINAL que mide (outcomeId) y el MODULO del plan donde ese tema se ensena (nodeId): el modulo tiene que estar en un objetivo que contribuye a esa comprension. De ahi
//      salen el corte en que se vio y el modulo que debe repasar (se derivan del plan, no se guardan aparte: no se pueden desincronizar);
//   2. una EXPLICACION de fondo (exp): por que la respuesta es la correcta, no solo cual es;
//   3. el MATERIAL EXPLICITO en que se apoya: un trozo de los materiales de la clase (materialId + chunkIndex) y una CITA TEXTUAL de ese trozo. La cita se comprueba contra el texto real
//      del trozo: si la IA inventa una cita o la cambia, la pregunta se rechaza. Asi "bajo que material" es verificable y no una afirmacion de la IA.
// Ademas tiene que pasar la auto-calificacion (JEV-1): simulada la jugada perfecta con los calificadores reales, sale correcta y cualquier otra, incorrecta.

import { selfGrade } from '@/lib/jev/selfGrade';
import type { Blueprint } from './types';

export const EXAM_TYPES = ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match'] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

// El estudiante NO ve los fragmentos numerados con que se le dio el material a la IA: una explicacion que dice "como se menciona en el fragmento 2" no le dice nada (y la fuente se muestra aparte).
const FRAGMENT_MENTION = /\b(fragmento|trozo|chunk|pasaje)\s*(n[.º°o]*\s*)?\d+\b|\[\d+\]/i;

// El examen se REPITE (hasta el 100 %) y conviene barajar las opciones entre intentos para que no se memorice la posicion: una explicacion que dice "la respuesta correcta es la B" senalaria la
// opcion equivocada. La explicacion debe decir el contenido, no la letra. (Hoy las lecciones NO barajan las opciones de opcion multiple; el examen deberia hacerlo: ver docs/EVALUACIONES.md.)
const OPTION_LETTER = /\b(opci[oó]n|alternativa|inciso|respuesta)\s+(correcta\s+)?(es\s+)?[«"'“(]?\s*[A-H]\s*[.)»"'”]?(?=[\s,.;:]|$)|['"“«]\s*[A-H][.)]\s/i;

export const EXAM_LIMITS = { question: 600, explanation: 1200, explanationMin: 40, quoteMin: 25, quoteMax: 400 } as const;

export interface ExamQuestionSource {
  materialId: string;
  chunkIndex: number;
  // Cita textual del trozo (comprobada contra su texto).
  quote: string;
}

export interface ExamQuestion {
  outcomeId: string;
  nodeId: string;
  type: ExamType;
  q: string;
  opts?: unknown;
  ok?: unknown;
  answers?: unknown;
  pairs?: unknown;
  keywords?: unknown;
  exp: string;
  source: ExamQuestionSource;
}

// Los trozos de material que existen (por clave "materialId:chunkIndex"), con el nombre del material para mostrarlo.
export type ChunkIndex = ReadonlyMap<string, { materialName: string; text: string }>;
export const chunkKey = (materialId: string, chunkIndex: number) => `${materialId}:${chunkIndex}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// Texto comparable: sin tildes, en minusculas y solo letras y numeros separados por un espacio. Tolera comillas, guiones y espacios distintos, pero NO palabras distintas.
export function comparable(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ¿La cita aparece de verdad en el trozo?
export const quoteIsInChunk = (quote: string, chunkText: string): boolean => {
  const q = comparable(quote);
  return q.length > 0 && ` ${comparable(chunkText)} `.includes(` ${q} `);
};

export type ValidateResult = { ok: true; question: ExamQuestion } | { ok: false; errors: string[] };

export function validateExamQuestion(raw: unknown, ctx: { plan: Blueprint; chunks: ChunkIndex }): ValidateResult {
  if (!isObj(raw)) return { ok: false, errors: ['La pregunta debe ser un objeto.'] };
  const errors: string[] = [];

  // 1. Atada al plan: la comprension, el modulo, y que el modulo la ensene.
  const outcomeId = typeof raw.outcomeId === 'string' ? raw.outcomeId : '';
  const nodeId = typeof raw.nodeId === 'string' ? raw.nodeId : '';
  if (!ctx.plan.outcomes.some((o) => o.id === outcomeId)) errors.push('La comprension final no existe en el plan.');
  const owner = ctx.plan.periods.flatMap((p) => p.objectives).find((ob) => ob.modules.some((m) => m.id === nodeId));
  if (!owner) errors.push('El modulo no existe en el plan.');
  else if (ctx.plan.outcomes.some((o) => o.id === outcomeId) && !owner.outcomeIds.includes(outcomeId)) errors.push('Ese modulo no ensena esa comprension final (su objetivo no contribuye a ella).');

  // 2. La pregunta.
  const type = raw.type;
  if (typeof type !== 'string' || !(EXAM_TYPES as readonly string[]).includes(type)) errors.push('El tipo de pregunta no es de los que el servidor califica.');
  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  if (q.length === 0) errors.push('La pregunta esta vacia.');
  else if (q.length > EXAM_LIMITS.question) errors.push(`La pregunta pasa de ${EXAM_LIMITS.question} caracteres.`);

  // 3. La explicacion de fondo.
  const exp = typeof raw.exp === 'string' ? raw.exp.trim() : '';
  if (exp.length < EXAM_LIMITS.explanationMin) errors.push(`Falta la explicacion de fondo (al menos ${EXAM_LIMITS.explanationMin} caracteres: por que esa es la respuesta).`);
  else if (exp.length > EXAM_LIMITS.explanation) errors.push(`La explicacion pasa de ${EXAM_LIMITS.explanation} caracteres.`);
  else if (comparable(exp) === comparable(q)) errors.push('La explicacion repite la pregunta.');

  if (FRAGMENT_MENTION.test(q) || FRAGMENT_MENTION.test(exp)) errors.push('La pregunta o la explicacion menciona un numero de fragmento: el estudiante no lo ve (la fuente se muestra aparte).');

  if (OPTION_LETTER.test(exp)) errors.push('La explicacion senala una opcion por su letra: el examen baraja las opciones entre intentos (di el contenido de la respuesta, no la letra).');

  // 4. El material explicito: existe el trozo y la cita esta en el.
  const src = isObj(raw.source) ? raw.source : null;
  let source: ExamQuestionSource | null = null;
  if (!src) errors.push('Falta el material en que se apoya (source).');
  else {
    const materialId = typeof src.materialId === 'string' ? src.materialId : '';
    const chunkIndex = src.chunkIndex;
    const quote = typeof src.quote === 'string' ? src.quote.trim() : '';
    if (!UUID_RE.test(materialId) || typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex) || chunkIndex < 0) errors.push('El material citado no es valido (materialId y chunkIndex).');
    else {
      const chunk = ctx.chunks.get(chunkKey(materialId, chunkIndex));
      if (!chunk) errors.push('El trozo de material citado no existe en los materiales de la clase.');
      else if (quote.length < EXAM_LIMITS.quoteMin || quote.length > EXAM_LIMITS.quoteMax) errors.push(`La cita debe tener entre ${EXAM_LIMITS.quoteMin} y ${EXAM_LIMITS.quoteMax} caracteres.`);
      else if (!quoteIsInChunk(quote, chunk.text)) errors.push('La cita NO aparece en el material citado (puede estar inventada o alterada).');
      else source = { materialId, chunkIndex, quote };
    }
  }

  // 5. Que se pueda calificar y no sea ambigua (JEV-1), con los calificadores reales.
  if (typeof type === 'string' && (EXAM_TYPES as readonly string[]).includes(type) && q.length > 0) {
    const sg = selfGrade({ type, q, opts: raw.opts, ok: raw.ok, answers: raw.answers, pairs: raw.pairs, keywords: raw.keywords });
    if (sg.status === 'fail') errors.push(...sg.failures.map((f) => `No se puede calificar bien: ${f}`));
  }

  if (errors.length > 0 || !source) return { ok: false, errors };
  return {
    ok: true,
    question: { outcomeId, nodeId, type: type as ExamType, q, opts: raw.opts, ok: raw.ok, answers: raw.answers, pairs: raw.pairs, keywords: raw.keywords, exp, source },
  };
}

// Donde se vio una pregunta, derivado del plan (corte y modulo) y del material (nombre).
export interface Provenance {
  periodId: string;
  periodName: string;
  nodeId: string;
  moduleTitle: string;
  outcomeId: string;
  outcomeStatement: string;
  materialId: string;
  materialName: string;
  quote: string;
}

export function provenanceOf(q: Pick<ExamQuestion, 'outcomeId' | 'nodeId' | 'source'>, plan: Blueprint, chunks: ChunkIndex): Provenance | null {
  for (const p of plan.periods) {
    for (const ob of p.objectives) {
      const m = ob.modules.find((x) => x.id === q.nodeId);
      if (!m) continue;
      const outcome = plan.outcomes.find((o) => o.id === q.outcomeId);
      if (!outcome) return null;
      const chunk = chunks.get(chunkKey(q.source.materialId, q.source.chunkIndex));
      return { periodId: p.id, periodName: p.name, nodeId: m.id, moduleTitle: m.title, outcomeId: outcome.id, outcomeStatement: outcome.statement, materialId: q.source.materialId, materialName: chunk?.materialName ?? '', quote: q.source.quote };
    }
  }
  return null;
}
