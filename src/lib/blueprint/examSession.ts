// La SESION de un examen: que preguntas se le sirven a un estudiante, como las ve (sin claves, con las opciones barajadas) y como se califica lo que contesta. Codigo puro, sin base de datos.
//
// Tres ideas:
//   1. El servidor DECIDE al empezar que preguntas se sirven y en que orden salen las opciones, y lo guarda (layout): al cerrar califica contra ESO, no contra lo que diga el navegador.
//   2. El estudiante recibe cada pregunta SIN la clave ni la explicacion ni la fuente (presentQuestion). Esas cosas llegan despues de cerrar, en la retroalimentacion (examFeedback).
//   3. Las opciones de opcion multiple se barajan POR INTENTO (las lecciones no las barajan): asi repetir el examen hasta el 100 % no se resuelve memorizando la posicion. Las opciones
//      guardan una letra al inicio («A. ...»); al barajar, la letra deja de coincidir con la posicion, asi que se QUITA y la pantalla pone las letras por posicion.

import { gradeAnswer } from '@/lib/grading/gradeAnswer';
import { approvedPool, type BankRow } from './examBank';
import { composeExam, type ComposeResult, type ExamKind } from './exam';
import type { ServedQuestion } from './examFeedback';
import type { Blueprint } from './types';

// Como se barajo cada pregunta en esa sesion. opts: la posicion ORIGINAL de la opcion que sale en cada lugar (opts[k] = indice original). defs: igual para las definiciones de emparejar.
export interface QuestionLayout {
  opts?: number[];
  defs?: number[];
}
export type SessionLayout = Record<string, QuestionLayout>;

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isIdentity = (p: readonly number[]) => p.every((v, i) => v === i);

function permutation(n: number, rng: () => number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}
// Una mezcla que no deja todo en su sitio (con 2 o mas elementos), para que barajar sirva de algo.
function shuffledPermutation(n: number, rng: () => number): number[] {
  let p = permutation(n, rng);
  for (let i = 0; i < 5 && n > 1 && isIdentity(p); i++) p = permutation(n, rng);
  return p;
}

// Quita la letra inicial de una opcion («A. texto», «b) texto»). Si no tiene letra, queda igual.
export const stripOptionLetter = (opt: string): string => opt.replace(/^\s*[A-Ha-h][.)]\s+/, '').trim();

export type StartResult = { ok: true; questionIds: string[]; layout: SessionLayout } | Exclude<ComposeResult, { ok: true }>;

// Elige las preguntas (solo las APROBADAS por el profesor, repartidas por comprension y modulo) y decide como se barajan.
export function startExam(args: { plan: Blueprint; rows: readonly BankRow[]; exam: ExamKind; size?: number; rng?: () => number }): StartResult {
  const rng = args.rng ?? Math.random;
  const composed = composeExam({ plan: args.plan, pool: approvedPool(args.rows), exam: args.exam, size: args.size, rng });
  if (!composed.ok) return composed;
  const byId = new Map(args.rows.map((r) => [r.id, r]));
  // composeExam ya entrega las preguntas en orden barajado.
  const order = composed.questionIds;
  const layout: SessionLayout = {};
  for (const id of order) {
    const row = byId.get(id)!;
    const entry: QuestionLayout = {};
    if (row.type === 'multiple_choice') entry.opts = shuffledPermutation(asStrings(row.opts).length, rng);
    if (row.type === 'match' && Array.isArray(row.pairs)) entry.defs = shuffledPermutation(row.pairs.length, rng);
    layout[id] = entry;
  }
  return { ok: true, questionIds: order, layout };
}

// Lo UNICO que recibe el estudiante de una pregunta durante el examen. Nunca: ok, answers, keywords, pairs, exp, la fuente ni el veredicto del juez.
export interface PresentedQuestion {
  id: string;
  type: string;
  q: string;
  opts?: string[];
  terms?: string[];
  defs?: string[];
}

export function presentQuestion(row: BankRow, layout: QuestionLayout | undefined): PresentedQuestion {
  const out: PresentedQuestion = { id: row.id, type: row.type, q: row.q };
  if (row.type === 'multiple_choice') {
    const opts = asStrings(row.opts).map(stripOptionLetter);
    const perm = layout?.opts && layout.opts.length === opts.length ? layout.opts : opts.map((_, i) => i);
    out.opts = perm.map((i) => opts[i]);
  }
  if (row.type === 'match' && Array.isArray(row.pairs)) {
    const pairs = (row.pairs as { term?: unknown; def?: unknown }[]).filter((p) => typeof p?.term === 'string' && typeof p?.def === 'string') as { term: string; def: string }[];
    const perm = layout?.defs && layout.defs.length === pairs.length ? layout.defs : pairs.map((_, i) => i);
    out.terms = pairs.map((p) => p.term);
    out.defs = perm.map((i) => pairs[i].def);
  }
  return out;
}

export interface GradedExam {
  results: Record<string, boolean>;
  correct: number;
  total: number;
  scorePercent: number;
}

// Califica lo que contesto el estudiante contra las preguntas que SE LE SERVIRON (rows, en orden) y su barajado. `answers` es un objeto {idDePregunta: respuesta} con la forma de cada tipo:
//   multiple_choice {selectedIndex} (posicion en lo que VIO) · true_false {selected} · fill_blank / short_answer {text} · match {defs} (el texto de la definicion conectada a cada termino).
// Lo que falta o no tiene la forma esperada cuenta como INCORRECTO (nunca tira ni regala puntos); los ids que no son del examen se ignoran.
export function gradeSession(args: { rows: readonly BankRow[]; layout: SessionLayout; answers: unknown }): GradedExam {
  const given = args.answers && typeof args.answers === 'object' && !Array.isArray(args.answers) ? (args.answers as Record<string, unknown>) : {};
  const results: Record<string, boolean> = {};
  for (const row of args.rows) {
    const a = Object.prototype.hasOwnProperty.call(given, row.id) ? given[row.id] : undefined;
    let answer: unknown = a;
    if (row.type === 'multiple_choice') {
      // El estudiante contesta una POSICION de lo que vio; la clave esta en posiciones originales.
      const perm = args.layout[row.id]?.opts;
      const sel = a && typeof a === 'object' ? (a as { selectedIndex?: unknown }).selectedIndex : undefined;
      answer = perm && typeof sel === 'number' && Number.isInteger(sel) && sel >= 0 && sel < perm.length ? { selectedIndex: perm[sel] } : undefined;
    }
    const g = gradeAnswer({ type: row.type, ok: row.ok, answers: row.answers, keywords: row.keywords, pairs: row.pairs }, answer);
    results[row.id] = g.status === 'graded' && g.correct;
  }
  const total = args.rows.length;
  const correct = Object.values(results).filter(Boolean).length;
  return { results, correct, total, scorePercent: total === 0 ? 0 : Math.round((correct / total) * 10000) / 100 };
}

// La fila del banco como pregunta servida, para armar la retroalimentacion.
export function servedFromRow(row: BankRow): ServedQuestion {
  return {
    id: row.id,
    outcomeId: row.outcome_id,
    nodeId: row.node_id,
    type: row.type as ServedQuestion['type'],
    q: row.q,
    opts: row.opts,
    ok: row.ok,
    answers: row.answers,
    pairs: row.pairs,
    keywords: row.keywords,
    exp: row.exp,
    source: { materialId: row.source_material_id, chunkIndex: row.source_chunk, quote: row.source_quote },
  };
}
