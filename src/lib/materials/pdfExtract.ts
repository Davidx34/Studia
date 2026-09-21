// Capa DETERMINISTA (sin IA) de la conversion de PDF a Markdown.
//
// Lee el texto del PDF con su posicion y tamaño de fuente y reconstruye lo que se puede reconstruir
// sin un modelo: titulos (por tamaño), listas, parrafos, encabezados y pies repetidos, y los acentos
// que LaTeX deja sueltos ("F´ormulas" -> "Fórmulas"). Es instantanea y gratis.
//
// Tambien CLASIFICA cada pagina: si tiene formulas ilegibles, imagenes grandes, dibujos con poco texto
// o tablas, esa pagina es "de riesgo" y solo esas van a un modelo con vision (ver pdfToMarkdown.ts).
// Medido con 7 presentaciones reales de Microeconomia I (231 paginas): el 77 % eran de riesgo, pero en
// un PDF de texto (articulos, apuntes) casi ninguna lo es y no se llama a ninguna IA.
//
// La logica pura (analyzePages) esta separada del lector de pdfjs (readPdfPages) para poder probarla.

import { countUnreadableSymbols } from './pdfMarkdown';

export interface RawItem {
  str: string;
  x: number; // posicion en la pagina YA girada, y crece hacia abajo
  y: number;
  size: number;
  width: number;
  hasEOL: boolean;
}

export interface RawPage {
  number: number;
  width: number;
  height: number;
  items: RawItem[];
  images: { w: number; h: number }[];
  paths: number;
}

export interface PdfLine {
  text: string;
  size: number;
  y: number;
  segments: number; // trozos de texto separados por huecos grandes: >=3 sugiere una tabla
}

export type RiskReason = 'formulas_ilegibles' | 'imagen' | 'dibujo' | 'tabla';

export interface PageData {
  number: number;
  markdown: string; // conversion determinista de la pagina
  text: string; // texto legible de la pagina (para verificar lo que transcriba la IA)
  chars: number;
  unreadable: number;
  risk: RiskReason[];
}

const BIG_IMAGE_PIXELS = 60_000; // un logo de ~200x200 no cuenta; una figura de diapositiva si
const DRAWING_PATHS = 40;
const DRAWING_MAX_CHARS = 500;
const TABLE_MIN_SEGMENTS = 3;
const TABLE_MIN_LINES = 3;
const HEADING_RATIO = 1.15;
const BULLET_RE = /^([•◦▪▫‣●○■□·∙◆➢➤▶►]|[-–—*])\s+/;
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// ---------------------------------------------------------------- acentos

const COMBINING: Record<string, string> = {
  '´': '́',
  '`': '̀',
  '¨': '̈',
  '˜': '̃',
  'ˆ': '̂',
};

// LaTeX (y algunos PDF) guardan el acento como un caracter suelto ANTES de la letra: "F´ormulas".
export function fixSpacingAccents(text: string): string {
  return text.replace(/([´`¨˜ˆ])\s?([a-zA-Zı])/g, (_m, accent: string, letter: string) => {
    const base = letter === 'ı' ? 'i' : letter;
    return (base + COMBINING[accent]).normalize('NFC');
  });
}

// ---------------------------------------------------------------- lineas

interface LineBuilder {
  y: number;
  size: number;
  parts: string[];
  lastEnd: number;
  segments: number;
}

function buildLines(items: RawItem[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let cur: LineBuilder | null = null;
  let forceBreak = false;

  const flush = () => {
    if (!cur) return;
    const text = fixSpacingAccents(cur.parts.join('').replace(/[ \t]+/g, ' ').trim());
    if (text.length > 0) lines.push({ text, size: cur.size, y: cur.y, segments: cur.segments });
    cur = null;
  };

  for (const it of items) {
    if (!it.str) {
      if (it.hasEOL) forceBreak = true;
      continue;
    }
    const sameLine = cur !== null && !forceBreak && Math.abs(it.y - cur.y) <= 0.55 * Math.max(it.size, cur.size, 1);
    if (!sameLine) {
      flush();
      cur = { y: it.y, size: it.size, parts: [], lastEnd: it.x, segments: 1 };
    }
    const c = cur as LineBuilder;
    const gap = it.x - c.lastEnd;
    const last = c.parts.length > 0 ? c.parts[c.parts.length - 1] : '';
    if (c.parts.length > 0 && gap > 0.2 * it.size && !last.endsWith(' ') && !it.str.startsWith(' ')) c.parts.push(' ');
    if (c.parts.length > 0 && gap > 2.5 * it.size) c.segments++;
    c.parts.push(it.str);
    c.lastEnd = it.x + it.width;
    c.size = Math.max(c.size, it.size);
    forceBreak = it.hasEOL;
  }
  flush();
  return lines;
}

// ---------------------------------------------------------------- analisis

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

function modeSize(lines: PdfLine[]): number {
  const weights = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    weights.set(k, (weights.get(k) ?? 0) + l.text.length);
  }
  let best = 0;
  let bestW = -1;
  weights.forEach((w, k) => {
    if (w > bestW) {
      best = k;
      bestW = w;
    }
  });
  return best;
}

export function analyzePages(raw: RawPage[]): PageData[] {
  // 1. Lineas por pagina (se conserva el orden del PDF: reordenar por posicion mezclaria columnas).
  const rawLines = raw.map((p) => ({ page: p, unreadable: countUnreadableSymbols(p.items.map((i) => i.str).join('')), lines: buildLines(p.items) }));

  // 2. Encabezados y pies repetidos.
  const zoneKeyCount = new Map<string, number>();
  const inZone = (l: PdfLine, h: number) => l.y < h * 0.09 || l.y > h * 0.91;
  for (const { page, lines } of rawLines) {
    const seen = new Set<string>();
    for (const l of lines) if (inZone(l, page.height)) seen.add(normalizeKey(l.text));
    seen.forEach((k) => zoneKeyCount.set(k, (zoneKeyCount.get(k) ?? 0) + 1));
  }
  const minRepeats = Math.max(3, Math.ceil(raw.length * 0.5));
  const cleaned = rawLines.map((r) => ({
    ...r,
    lines: r.lines.filter((l) => {
      if (!inZone(l, r.page.height)) return true;
      if (/^\d{1,4}$/.test(l.text.trim())) return false; // numero de pagina suelto
      return raw.length < 3 || (zoneKeyCount.get(normalizeKey(l.text)) ?? 0) < minRepeats;
    }),
  }));

  // 3. Tamaño del cuerpo y niveles de titulo de TODO el documento (consistentes entre paginas).
  const allLines = cleaned.flatMap((c) => c.lines);
  const body = modeSize(allLines);
  const headingSizes = Array.from(
    new Set(allLines.filter((l) => body > 0 && l.size >= body * HEADING_RATIO && l.text.length <= 110).map((l) => Math.round(l.size * 2) / 2))
  ).sort((a, b) => b - a);
  const levelOf = (size: number) => Math.min(3, headingSizes.indexOf(Math.round(size * 2) / 2) + 1);

  // 4. Markdown y riesgo por pagina.
  return cleaned.map(({ page, lines, unreadable }) => {
    const blocks: string[] = [];
    let paragraph: { text: string; size: number; y: number } | null = null;
    let bullets: string[] = [];

    const flushParagraph = () => {
      if (paragraph) blocks.push(paragraph.text);
      paragraph = null;
    };
    const flushBullets = () => {
      if (bullets.length) blocks.push(bullets.join('\n'));
      bullets = [];
    };

    for (const l of lines) {
      const isHeading = body > 0 && l.size >= body * HEADING_RATIO && l.text.length <= 110;
      const bullet = l.text.match(BULLET_RE);
      const isTableRow = l.segments >= 2;

      if (isHeading) {
        flushParagraph();
        flushBullets();
        blocks.push(`${'#'.repeat(levelOf(l.size))} ${l.text}`);
      } else if (bullet) {
        flushParagraph();
        bullets.push(`- ${l.text.slice(bullet[0].length)}`);
      } else if (isTableRow) {
        flushParagraph();
        flushBullets();
        blocks.push(l.text);
      } else if (paragraph && l.y - paragraph.y <= 1.7 * Math.max(l.size, 1) && l.y > paragraph.y) {
        // Continuacion del parrafo (o de la vineta anterior si no hay parrafo abierto).
        paragraph.text = /[a-záéíóúñ]-$/.test(paragraph.text) && /^[a-záéíóúñ]/.test(l.text) ? paragraph.text.slice(0, -1) + l.text : `${paragraph.text} ${l.text}`;
        paragraph.y = l.y;
      } else if (bullets.length > 0 && l.text.length > 0 && !paragraph && l.y > 0) {
        // Linea que sigue a una vineta sin marcador propio: es su continuacion.
        bullets[bullets.length - 1] += ` ${l.text}`;
      } else {
        flushBullets();
        flushParagraph();
        paragraph = { text: l.text, size: l.size, y: l.y };
      }
    }
    flushParagraph();
    flushBullets();

    const text = lines.map((l) => l.text).join('\n');
    const chars = text.replace(/\s/g, '').length;

    const risk: RiskReason[] = [];
    if (unreadable > 0) risk.push('formulas_ilegibles');
    if (page.images.some((i) => i.w * i.h >= BIG_IMAGE_PIXELS)) risk.push('imagen');
    if (page.paths >= DRAWING_PATHS && chars < DRAWING_MAX_CHARS) risk.push('dibujo');
    let run = 0;
    let tableRun = false;
    for (const l of lines) {
      run = l.segments >= TABLE_MIN_SEGMENTS ? run + 1 : 0;
      if (run >= TABLE_MIN_LINES) tableRun = true;
    }
    if (tableRun) risk.push('tabla');

    return { number: page.number, markdown: blocks.join('\n\n').replace(CONTROL_RE, ''), text, chars, unreadable, risk };
  });
}

// ---------------------------------------------------------------- lector de pdfjs

export async function readRawPages(bytes: Uint8Array): Promise<RawPage[]> {
  const { getDocumentProxy, getResolvedPDFJS } = await import('unpdf');
  const pdfjs: any = await getResolvedPDFJS();
  const { OPS, Util } = pdfjs;
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: RawPage[] = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const page: any = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc: any = await page.getTextContent();

    const items: RawItem[] = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      // La matriz del viewport aplica la rotacion de la pagina: sin esto las diapositivas giradas 90 grados
      // salen con x e y intercambiadas.
      const m = Util.transform(vp.transform, it.transform);
      items.push({
        str: it.str,
        x: m[4],
        y: m[5],
        size: it.height || Math.hypot(m[2], m[3]),
        width: it.width || 0,
        hasEOL: !!it.hasEOL,
      });
    }

    const ops = await page.getOperatorList();
    const images: { w: number; h: number }[] = [];
    let paths = 0;
    ops.fnArray.forEach((fn: number, i: number) => {
      const args = ops.argsArray[i];
      if (fn === OPS.paintImageXObject) images.push({ w: Number(args?.[1]) || 0, h: Number(args?.[2]) || 0 });
      else if (fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) images.push({ w: Number(args?.[0]?.width) || 0, h: Number(args?.[0]?.height) || 0 });
      else if (fn === OPS.constructPath) paths++;
    });

    pages.push({ number: n, width: vp.width, height: vp.height, items, images, paths });
  }
  return pages;
}

export async function readPdfPages(bytes: Uint8Array): Promise<PageData[]> {
  return analyzePages(await readRawPages(bytes));
}
