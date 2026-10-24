// "Repasa en tu material": al cerrar una pregunta fallada, localiza en el material de la clase el pasaje mas probable
// de donde sale la respuesta. Es una PISTA, no una cita: se busca por texto (sin embeddings, asi no gasta cuota de IA)
// con la pregunta y su respuesta correcta, y solo se muestra si algun pasaje comparte varios terminos con ellas.

import { sectionOf } from '@/lib/study/grouping';

export interface SourceHint {
  // Nombre del material (sin extension).
  material: string;
  // Seccion dentro del material, si el fragmento la trae.
  section: string | null;
  // Frase(s) del material mas parecidas a la pregunta y su respuesta.
  excerpt: string;
}

export interface HintChunk {
  content: string;
  filename?: string | null;
}

const STOPWORDS = new Set(
  (
    'para como pero porque cuando donde entre sobre desde hasta esta este estos estas esto esos esas cual cuales ' +
    'cada tiene tienen puede pueden segun otro otros otra otras tambien mismo misma muy mas menos todo todos toda todas ' +
    'sera seran fue fueron son ser hay con sin por del las los una uno unos unas que quien quienes aquel aquella ' +
    'afirmacion verdadera falsa verdadero falso correcta correcto opcion respuesta siguiente siguientes'
  ).split(' ')
);

const MIN_SHARED_TERMS = 2;
// Parte del peso total de los terminos de la consulta que debe cubrir la frase elegida (afinado con preguntas reales).
const MIN_COVERAGE = 0.3;
const MAX_EXCERPT_CHARS = 280;
const MAX_SECTION_CHARS = 80;
const MAX_QUERY_CHARS = 500;

// Marcas combinantes Unicode (tildes tras normalizar a NFD), armadas por codigo para no depender de escapes.
const COMBINING_MARKS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
const strip = (s: string) => s.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();

// Terminos distintivos de un texto: minusculas, sin tildes, 4+ letras, sin palabras vacias.
export function termsOf(text: string): string[] {
  const out = new Set<string>();
  for (const w of strip(text).split(/[^a-z0-9ñ]+/)) {
    if (w.length >= 4 && !STOPWORDS.has(w)) out.add(w);
  }
  return Array.from(out);
}

// Texto de busqueda: la pregunta mas lo que ya se revelo como correcto (la respuesta vive donde esta la fuente).
export function buildSourceQuery(q: { q?: unknown; type?: unknown; opts?: unknown; ok?: unknown; answers?: unknown; keywords?: unknown; pairs?: unknown }): string {
  const parts: string[] = [];
  if (typeof q.q === 'string') parts.push(q.q.replace(/_{2,}/g, ' '));
  switch (q.type) {
    case 'multiple_choice': {
      const opts = Array.isArray(q.opts) ? q.opts : [];
      const right = typeof q.ok === 'number' ? opts[q.ok] : undefined;
      if (typeof right === 'string') parts.push(right.replace(/^[A-Za-z][.)]\s*/, ''));
      break;
    }
    case 'fill_blank':
      if (Array.isArray(q.answers)) parts.push(q.answers.filter((a) => typeof a === 'string').join(' '));
      break;
    case 'short_answer':
      if (Array.isArray(q.keywords)) parts.push(q.keywords.filter((a) => typeof a === 'string').join(' '));
      break;
    case 'match':
      if (Array.isArray(q.pairs)) parts.push(q.pairs.map((p: any) => `${p?.term ?? ''} ${p?.def ?? ''}`).join(' '));
      break;
    default:
      break;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
}

const cleanName = (filename?: string | null) => (filename ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_]+/g, ' ').trim();

function sentencesOf(content: string): string[] {
  const body = content.replace(/^\s*\[Secci[oó]n:[^\]]*\]\s*/, '');
  return body
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 25);
}

function clip(text: string): string {
  if (text.length <= MAX_EXCERPT_CHARS) return text;
  const cut = text.slice(0, MAX_EXCERPT_CHARS);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 120)).trimEnd() + '…';
}

// Elige el pasaje mas parecido a la consulta. Los terminos pesan por RAREZA dentro de lo recuperado (un termino que sale en casi
// todas las frases, como "demanda" o "precio" en un curso de microeconomia, casi no distingue un pasaje de otro) y se exige que la
// frase cubra una parte importante de lo que la pregunta menciona. Un termino de la pregunta que no aparece en ningun pasaje
// pesa mucho en contra: si "hicksiana" no esta en el material, una frase que solo comparte "demanda" no es la fuente.
// null = ninguna frase alcanza (mejor no mostrar nada que una pista que no viene al caso).
export function pickSourceHint(chunks: HintChunk[], queryText: string): SourceHint | null {
  const queryTerms = termsOf(queryText);
  if (queryTerms.length < MIN_SHARED_TERMS) return null;

  const entries: { chunk: HintChunk; sentence: string; next: string; terms: Set<string> }[] = [];
  for (const chunk of chunks) {
    const sentences = sentencesOf(chunk.content);
    sentences.forEach((sentence, i) => entries.push({ chunk, sentence, next: sentences[i + 1] ?? '', terms: new Set(termsOf(sentence)) }));
  }
  if (entries.length === 0) return null;

  const weight = new Map<string, number>();
  for (const t of queryTerms) {
    const df = entries.reduce((n, e) => n + (e.terms.has(t) ? 1 : 0), 0);
    weight.set(t, Math.log(1 + (entries.length + 1) / (df + 1)));
  }
  const totalWeight = queryTerms.reduce((n, t) => n + (weight.get(t) ?? 0), 0);

  let best: (typeof entries)[number] | null = null;
  let bestCoverage = 0;
  let bestShared = 0;
  for (const e of entries) {
    let got = 0;
    let shared = 0;
    for (const t of queryTerms) {
      if (e.terms.has(t)) {
        got += weight.get(t) ?? 0;
        shared += 1;
      }
    }
    const coverage = totalWeight > 0 ? got / totalWeight : 0;
    if (coverage > bestCoverage) {
      best = e;
      bestCoverage = coverage;
      bestShared = shared;
    }
  }
  if (!best || bestShared < MIN_SHARED_TERMS || bestCoverage < MIN_COVERAGE) return null;

  // Una frase corta suelta poco contexto: se le suma la siguiente.
  const text = best.sentence.length < 110 && best.next ? `${best.sentence} ${best.next}` : best.sentence;
  const rawSection = sectionOf(best.chunk.content);
  // Algunos documentos traen "secciones" que son un numero de pagina o un signo suelto: no sirven de titulo.
  const validSection = rawSection && (rawSection.match(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/g) ?? []).length >= 4 ? rawSection : null;
  const section = validSection && validSection.length > MAX_SECTION_CHARS ? validSection.slice(0, MAX_SECTION_CHARS).trimEnd() + '…' : validSection;
  return { material: cleanName(best.chunk.filename) || 'Material de la clase', section, excerpt: clip(text) };
}

const SEARCH_TIMEOUT_MS = 2500;

export interface FindHintInput {
  classroomId: string;
  // Materiales a los que esta vinculado el modulo; vacio = toda la clase.
  materialIds: string[];
  question: Parameters<typeof buildSourceQuery>[0];
}

// Busca por texto en la base. Cualquier fallo o demora devuelve null: la pista es un extra y NUNCA debe retrasar ni romper
// el cierre de una pregunta.
export async function findSourceHint(supabase: any, input: FindHintInput): Promise<SourceHint | null> {
  const queryText = buildSourceQuery(input.question);
  if (termsOf(queryText).length < MIN_SHARED_TERMS) return null;
  const search = async (materialIds: string[] | null): Promise<HintChunk[]> => {
    const { data, error } = await supabase.rpc('match_material_chunks_hybrid', {
      query_embedding: null,
      query_text: queryText,
      classroom_id_filter: input.classroomId,
      material_ids: materialIds,
      match_count: 4,
      vector_models: null,
      vector_weight: 0,
      text_weight: 1,
    });
    if (error) throw new Error(String(error.message ?? error));
    return ((data ?? []) as any[]).map((r) => ({ content: String(r.content ?? ''), filename: r.filename ?? null }));
  };
  const work = async (): Promise<SourceHint | null> => {
    let chunks = input.materialIds.length > 0 ? await search(input.materialIds) : [];
    if (chunks.length === 0) chunks = await search(null);
    return pickSourceHint(chunks, queryText);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SEARCH_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    console.warn('[source-hint]', e instanceof Error ? e.message : e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
