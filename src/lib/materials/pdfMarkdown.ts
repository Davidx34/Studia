// Piezas puras (sin red ni base de datos) de la conversion de PDF a Markdown.
//
// El flujo (pdfToMarkdown.ts): un modelo con vision transcribe el PDF a Markdown por tandas de
// paginas; aqui se arma el pedido, se limpia la respuesta y se decide si el resultado es de fiar
// comparandolo con el texto que la extraccion simple si pudo leer.

// Tandas de 10 paginas. Medido con gemini-2.5-flash-lite sobre un PDF real de 47 diapositivas: una
// tanda de 20 paginas tardo 65 s y devolvio 503 ("alta demanda"); una de 10 respondio en 55 s. Cada
// llamada corta tiene menos riesgo de 503 o de timeout, y la salida cabe holgada en el limite de tokens.
export const PAGES_PER_BATCH = 10;
const PAGE_MARKER_RE = /^\s*\[\[\s*P[ÁA]GINA\s+(\d+)\s*\]\]\s*$/im;
const PAGE_MARKER_GLOBAL_RE = /^\s*\[\[\s*P[ÁA]GINA\s+(\d+)\s*\]\]\s*$/gim;

export function splitPageRanges(totalPages: number, batchSize = PAGES_PER_BATCH): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (let from = 1; from <= totalPages; from += batchSize) {
    ranges.push({ from, to: Math.min(totalPages, from + batchSize - 1) });
  }
  return ranges;
}

export function buildPdfPrompt(range: { from: number; to: number }, totalPages: number): string {
  const scope =
    range.from === 1 && range.to === totalPages
      ? 'Transcribe TODO el documento.'
      : `Transcribe SOLO las paginas ${range.from} a ${range.to} (la primera pagina del PDF es la 1). Ignora las demas.`;
  return `${scope}
Convierte este documento (puede ser un articulo o diapositivas) a Markdown para un sistema de estudio.

Reglas:
- Conserva el orden y el texto EXACTO. No resumas, no expliques, no agregues ejemplos ni contenido que no este en la pagina.
- Titulos con # o ##; listas con "- "; tablas en formato de tabla Markdown.
- Formulas en LaTeX: en linea entre $...$ y en bloque entre $$...$$.
- Si hay un grafico o figura, agrega una linea: "> [Figura: descripcion breve de lo que muestra, con ejes y etiquetas visibles]".
- Omite numeros de pagina y encabezados o pies de pagina que se repiten.
- Si algo es ilegible, escribe [ilegible]. No lo inventes.
- Antes del contenido de cada pagina escribe una linea con exactamente: [[PAGINA N]] (N = numero de pagina del PDF).
- No escribas introducciones ni despedidas: solo el Markdown.`;
}

// Quita lo que el modelo agrega alrededor: bloque ```markdown envolvente y frases de cortesia
// antes del primer marcador de pagina.
export function cleanModelMarkdown(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) text = fenced[1].trim();
  const first = text.search(PAGE_MARKER_RE);
  if (first > 0) text = text.slice(first);
  return text.trim();
}

export interface ParsedPages {
  pages: Map<number, string>;
  hadMarkers: boolean;
}

export function parsePages(markdown: string): ParsedPages {
  const pages = new Map<number, string>();
  const matches = Array.from(markdown.matchAll(PAGE_MARKER_GLOBAL_RE));
  if (matches.length === 0) return { pages, hadMarkers: false };
  matches.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length;
    const n = Number(m[1]);
    const body = markdown.slice(start, end).trim();
    // Si un numero se repite, se conserva el contenido mas largo.
    if (!pages.has(n) || body.length > (pages.get(n) ?? '').length) pages.set(n, body);
  });
  return { pages, hadMarkers: true };
}

// Une las paginas en orden, sin marcadores.
export function joinPages(pages: Map<number, string>): string {
  return Array.from(pages.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, body]) => body)
    .filter((b) => b.length > 0)
    .join('\n\n');
}

// Limpieza segura para Markdown. NO usa sanitizeText, que colapsa espacios y aplasta la sangria
// de las listas anidadas.
export function sanitizeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Caracteres de control que deja un PDF cuando una fuente no se pudo decodificar. En las
// diapositivas de Microeconomia I eran las formulas (entre 0,1 % y 8,7 % del texto).
export function countUnreadableSymbols(text: string): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c < 32 && c !== 10 && c !== 9 && c !== 13) || (c >= 0xe000 && c <= 0xf8ff)) n++;
  }
  return n;
}

function normalizeWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  return new Set(words);
}

// Que fraccion de las palabras del texto simple aparece en el Markdown. Si el modelo se salto
// una pagina o resumio, esta cifra cae.
export function wordRecall(plainText: string, markdown: string): number | null {
  const plain = normalizeWords(plainText);
  if (plain.size < 30) return null; // muy poco texto simple: no hay con que comparar
  const md = normalizeWords(markdown);
  let hit = 0;
  plain.forEach((w) => {
    if (md.has(w)) hit++;
  });
  return hit / plain.size;
}

export interface QualityInput {
  expectedPages: number;
  pagesFound: number;
  plainText: string;
  markdown: string;
}

export interface QualityResult {
  ok: boolean;
  recall: number | null;
  pageCoverage: number;
  reasons: string[];
}

// Paginas que se toleran sin transcribir: una pagina casi vacia (solo un grafico, o en blanco) puede
// quedar sin marcador. 10 % del documento y, como minimo, una pagina.
export function allowedMissingPages(expectedPages: number): number {
  return Math.max(1, Math.floor(expectedPages * 0.1));
}
export const MIN_WORD_RECALL = 0.85;

// Decide si el Markdown se puede usar en lugar del texto simple.
export function assessConversion(input: QualityInput): QualityResult {
  const reasons: string[] = [];
  const pageCoverage = input.expectedPages > 0 ? input.pagesFound / input.expectedPages : 0;
  if (input.expectedPages - input.pagesFound > allowedMissingPages(input.expectedPages)) {
    reasons.push(`solo se transcribieron ${input.pagesFound} de ${input.expectedPages} paginas`);
  }

  const recall = wordRecall(input.plainText, input.markdown);
  if (recall !== null && recall < MIN_WORD_RECALL) {
    reasons.push(`el Markdown solo conserva el ${Math.round(recall * 100)}% de las palabras del texto original`);
  }

  const mdChars = input.markdown.length;
  if (mdChars < 50) reasons.push('el Markdown quedo casi vacio');
  // Mucho mas largo que el original delata contenido inventado (una descripcion de figuras y las
  // formulas suman, pero no multiplican el texto por seis).
  if (input.plainText.length > 200 && mdChars > input.plainText.length * 6 + 3000) {
    reasons.push('el Markdown es desproporcionadamente mas largo que el texto original');
  }

  return { ok: reasons.length === 0, recall, pageCoverage, reasons };
}
