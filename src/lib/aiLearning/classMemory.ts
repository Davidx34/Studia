// Memorias nuevas de la clase (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §11):
//  1. NOTAS DEL PROFESOR (tabla ai_class_notes, migracion 102): contexto que solo el profesor conoce. Escritas por el, activas hasta que las retira. Entran al prompt cuando existen.
//  2. ERRORES COMUNES POR CONCEPTO: derivados de los motivos de rechazo de lesson_questions (no se guardan aparte). Solo cuentan errores atribuibles al GENERADOR.
//  3. EJEMPLOS APROBADOS: preguntas que el PROFESOR aprobo, como referencia de calidad por concepto.
// Las notas son decision explicita del profesor, asi que no necesitan permiso extra. (2) y (3) son automaticas y su efecto NO esta medido (los experimentos A/B del juez estaban en el techo):
// quedan APAGADAS hasta que el auditor estricto muestre mejora (CLASS_MEMORY=on). Todo es texto que entra a un prompt: se limpia y se acota.
import { CATEGORIES, classifyReason, isFormValidatorReason, type ErrorCategory } from './errorTaxonomy';

export const MAX_NOTES = 15;
export const MAX_NOTE_CHARS = 300;
export const MIN_NOTE_CHARS = 8;
export const NOTES_BLOCK_BUDGET = 1500;
export const DERIVED_BLOCK_BUDGET = 1400;
export const MIN_CONCEPT_ERRORS = 3; // con menos casos de un mismo error en un concepto no es patron, es azar
export const MAX_CONCEPT_HINTS = 4;
export const MAX_EXEMPLARS = 3;

export const classMemoryDerivedEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.CLASS_MEMORY?.trim().toLowerCase() === 'on';

// Texto que va DENTRO de un prompt: sin saltos de linea ni marcadores que imiten instrucciones del sistema.
const clean = (s: unknown, max: number): string =>
  String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[`#<>]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);

export function sanitizeNote(input: unknown): string | null {
  const t = clean(input, MAX_NOTE_CHARS);
  return t.length >= MIN_NOTE_CHARS ? t : null;
}

const within = (lines: string[], budget: number): string[] => {
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 > budget) break;
    out.push(l);
    used += l.length + 1;
  }
  return out;
};

/** Bloque de notas del profesor, o ''. Complementan (nunca reemplazan) el material y la configuracion. */
export function classNotesBlock(notes: (string | { text: string })[] | null | undefined): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const n of notes ?? []) {
    const t = sanitizeNote(typeof n === 'string' ? n : n?.text);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    lines.push(`- ${t}`);
    if (lines.length >= MAX_NOTES) break;
  }
  const kept = within(lines, NOTES_BLOCK_BUDGET);
  return kept.length ? `CONTEXTO DE ESTA CLASE (escrito por el profesor; no contradice el material ni las instrucciones de arriba):\n${kept.join('\n')}` : '';
}

export interface ConceptErrorRow {
  concept_tag: string | null;
  review_status: string | null;
  review_reason: string | null;
}
export interface ConceptHint {
  concept: string;
  category: ErrorCategory;
  count: number;
}

/** Errores del generador que se repiten dentro de un mismo concepto. Ignora infraestructura, pipeline, sin clasificar, el validador de forma y los conceptos sin etiqueta. */
export function conceptErrorHints(rows: ConceptErrorRow[]): ConceptHint[] {
  const tally = new Map<string, number>();
  for (const r of rows) {
    if (!r.concept_tag || r.review_status === 'approved' || r.review_status === 'pending' || isFormValidatorReason(r.review_reason)) continue;
    const cat = classifyReason(r.review_reason);
    if (CATEGORIES[cat].origin !== 'generador') continue;
    const k = `${r.concept_tag}\u0000${cat}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return Array.from(tally.entries())
    .map(([k, count]) => {
      const [concept, category] = k.split('\u0000');
      return { concept, category: category as ErrorCategory, count };
    })
    .filter((h) => h.count >= MIN_CONCEPT_ERRORS)
    .sort((a, b) => b.count - a.count || a.concept.localeCompare(b.concept))
    .slice(0, MAX_CONCEPT_HINTS);
}

export interface Exemplar {
  concept_tag: string | null;
  q: string;
}

/** Bloque derivado (errores comunes + ejemplos aprobados), o ''. Los ejemplos son de REFERENCIA de calidad, nunca para copiar. */
export function derivedBlock(hints: ConceptHint[], exemplars: Exemplar[]): string {
  const lines: string[] = [];
  for (const h of hints) lines.push(`- En «${clean(h.concept, 60)}» se han rechazado ${h.count} preguntas por: ${CATEGORIES[h.category].label.toLowerCase()}. ${CATEGORIES[h.category].remedy}`);
  const out: string[] = [];
  const kept = within(lines, DERIVED_BLOCK_BUDGET);
  if (kept.length) out.push(`ERRORES QUE SE REPITEN EN ESTA CLASE (evitalos):\n${kept.join('\n')}`);
  const ex = exemplars
    .map((e) => clean(e.q, 220))
    .filter((q) => q.length >= 20)
    .slice(0, MAX_EXEMPLARS);
  if (ex.length) out.push(`PREGUNTAS QUE EL PROFESOR YA APROBO (solo como referencia de calidad y nivel; NO las copies ni repitas su tema exacto):\n${ex.map((q) => `- ${q}`).join('\n')}`);
  return out.join('\n\n');
}

type DbLike = { from: (t: string) => any };

/**
 * Lee las memorias de la clase y arma su bloque. `db` debe poder leer ai_class_notes (el profesor dueno por RLS, o la llave de servidor). Nunca lanza: ante cualquier fallo
 * devuelve '' y la generacion sigue como siempre. Los derivados solo se leen con CLASS_MEMORY=on.
 */
export async function loadClassMemoryBlock(db: DbLike | null, classroomId: string, opts: { derived?: boolean } = {}): Promise<string> {
  if (!db) return '';
  const parts: string[] = [];
  try {
    const { data } = await db.from('ai_class_notes').select('text').eq('classroom_id', classroomId).eq('status', 'active').order('created_at', { ascending: true }).limit(MAX_NOTES);
    const notes = classNotesBlock(data ?? []);
    if (notes) parts.push(notes);
  } catch {
    /* sin notas */
  }
  if (opts.derived ?? classMemoryDerivedEnabled()) {
    try {
      const { data: mods } = await db.from('content_modules').select('id').eq('classroom_id', classroomId);
      const ids = (mods ?? []).map((m: any) => m.id);
      if (ids.length) {
        const { data: rej } = await db.from('lesson_questions').select('concept_tag, review_status, review_reason').in('module_id', ids).in('review_status', ['rejected', 'human_review']).limit(2000);
        const { data: good } = await db.from('lesson_questions').select('concept_tag, q').in('module_id', ids).eq('review_status', 'approved').eq('reviewed_by', 'teacher').in('type', ['multiple_choice', 'true_false', 'fill_blank', 'short_answer']).order('reviewed_at', { ascending: false }).limit(MAX_EXEMPLARS);
        const d = derivedBlock(conceptErrorHints((rej ?? []) as ConceptErrorRow[]), (good ?? []) as Exemplar[]);
        if (d) parts.push(d);
      }
    } catch {
      /* sin derivados */
    }
  }
  return parts.join('\n\n');
}

/** Cuaderno de estilo activo + memorias de la clase, en un solo bloque para el prompt de generacion. Nunca lanza. */
export async function loadStyleAndMemoryBlock(db: DbLike | null, classroomId: string): Promise<string> {
  const { loadActivePlaybookBlock } = await import('./playbook');
  const [pb, mem] = await Promise.all([loadActivePlaybookBlock(db, classroomId), loadClassMemoryBlock(db, classroomId)]);
  return [pb, mem].filter(Boolean).join('\n\n');
}
