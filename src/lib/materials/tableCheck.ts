// Deteccion de TABLAS TRANSPUESTAS en lo que transcribe un modelo con vision.
//
// Problema (medido): con el mismo PDF, el mismo modelo y temperatura 0, una corrida transcribio bien una tabla de demandas y otra la dejo
// transpuesta (filas por columnas). Tiene los mismos simbolos, los mismos numeros y LaTeX valido: los controles de pdfVerify.ts no la ven.
//
// Como se detecta, sin IA: el texto determinista de la pagina (pdfExtract.ts) conserva las FILAS de la tabla, una por linea (los elementos de
// texto con la misma altura se juntan en una linea). Entonces, para cada tabla de la transcripcion:
//   - una transcripcion fiel tiene sus FILAS juntas en una linea del texto original, y sus columnas repartidas en varias lineas;
//   - una transpuesta tiene al reves: son sus COLUMNAS las que aparecen juntas en una linea.
// Solo se acusa con evidencia positiva: las columnas encajan en una sola linea y las filas claramente no. Si el texto original no sirve (cada celda
// en su propia linea, tabla girada, escaneo), ninguna orientacion encaja y NO se dice nada. Una tabla simetrica (ambas orientaciones encajan)
// tampoco se acusa.
//
// Limite conocido: una tabla GIRADA 90 grados en el PDF tiene sus columnas en lineas; ahi una transcripcion correcta parece transpuesta. El
// costo es seguro: la pagina vuelve al texto determinista (nunca se guarda una transcripcion dudosa).

export interface MarkdownTable {
  rows: string[][]; // incluye la fila de encabezado; sin la fila de separadores
}

export interface TableOrientation {
  rowFit: number; // 0..1: fraccion media de las celdas de cada fila que aparecen juntas en UNA linea del texto original
  colFit: number; // idem para las columnas
  transposed: boolean;
}

export interface TableCheck {
  tables: number; // tablas con forma suficiente para comparar
  transposed: number[]; // numero (1..n) de las tablas transpuestas
  details: TableOrientation[];
}

export const MIN_TABLE_ROWS = 3;
export const MIN_TABLE_COLS = 3;
export const MAX_TABLES = 5;
export const MAX_TABLE_ROWS = 60;
export const MAX_TABLE_COLS = 12;
// Una orientacion "encaja" si, en promedio, al menos esta fraccion de las celdas de cada grupo cae en una sola linea.
export const FIT_MIN = 0.6;
// Y la otra debe quedar claramente por debajo.
export const FIT_GAP = 0.3;
const MAX_CELL_CHARS = 40;

// Fila de separadores de GFM: "|---|:-:|--:|". Solo vale como separador la SEGUNDA linea del bloque (justo despues del encabezado): una fila de
// datos hecha de guiones ("| - | - | - |", celdas vacias) mas abajo no es un separador.
const SEPARATOR_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  // `\|` es una barra escapada dentro de una celda, no un separador.
  return t.split(/(?<!\\)\|/).map((c) => c.trim());
}

// Tablas en formato Markdown ("| a | b |" con su fila "|---|---|"). Descarta las que no tienen la forma minima para comparar.
export function extractMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const tables: MarkdownTable[] = [];
  let block: string[] = [];
  const flush = () => {
    if (block.length >= 2 && SEPARATOR_ROW.test(block[1])) {
      const rows = block.filter((_, i) => i !== 1).map(splitRow);
      const cols = Math.max(...rows.map((r) => r.length));
      if (rows.length >= MIN_TABLE_ROWS && cols >= MIN_TABLE_COLS && rows.length <= MAX_TABLE_ROWS && cols <= MAX_TABLE_COLS) {
        tables.push({ rows: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? '')) });
      }
    }
    block = [];
  };
  for (const l of lines) {
    if (l.trim().startsWith('|')) block.push(l);
    else flush();
  }
  flush();
  return tables.slice(0, MAX_TABLES);
}

// Texto comparable: minusculas, sin tildes, sin marcas de Markdown/LaTeX, espacios colapsados. `symbols` convierte "\beta" en "β" (ver pdfVerify.ts).
export function normalizeCell(raw: string, symbols: (s: string) => string = (s) => s): string {
  return symbols(raw)
    .replace(/\\\$/g, '$')
    .replace(/\$/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[*_`{}\\^]/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Letra (las que tienen mayuscula y minuscula: latinas con tilde, griegas) o digito.
const isWordChar = (ch: string | undefined): boolean => !!ch && (/[0-9]/.test(ch) || ch.toLowerCase() !== ch.toUpperCase());

// Cuantas de las celdas aparecen en la linea, cada una en su propio lugar (si una celda se repite, la linea debe traerla repetida).
export function cellsInLine(cells: string[], line: string): number {
  let rest = ' ' + line + ' ';
  let hit = 0;
  for (const cell of cells) {
    let from = 0;
    for (;;) {
      const i = rest.indexOf(cell, from);
      if (i < 0) break;
      // Debe ser una palabra/numero completo: "5" no cuenta dentro de "15".
      if (!isWordChar(rest[i - 1]) && !isWordChar(rest[i + cell.length])) {
        rest = rest.slice(0, i) + ' '.repeat(cell.length) + rest.slice(i + cell.length);
        hit++;
        break;
      }
      from = i + 1;
    }
  }
  return hit;
}

// Para un grupo de celdas (una fila o una columna): la mayor fraccion que cae junta en UNA sola linea del texto original. null = el grupo no tiene
// celdas utiles para comparar.
function bestLineFit(group: string[], lines: string[]): number | null {
  const cells = group.filter((c) => c.length > 0 && c.length <= MAX_CELL_CHARS);
  if (cells.length < 3) return null;
  let best = 0;
  for (const line of lines) best = Math.max(best, cellsInLine(cells, line));
  return best / cells.length;
}

const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

export function tableOrientation(table: MarkdownTable, plainLines: string[], symbols?: (s: string) => string): TableOrientation | null {
  const norm = table.rows.map((r) => r.map((c) => normalizeCell(c, symbols)));
  const cols = norm[0].length;
  const rowFits = norm.map((r) => bestLineFit(r, plainLines)).filter((x): x is number => x !== null);
  const colFits = Array.from({ length: cols }, (_, j) => bestLineFit(norm.map((r) => r[j]), plainLines)).filter((x): x is number => x !== null);
  const rowFit = mean(rowFits);
  const colFit = mean(colFits);
  if (rowFit === null || colFit === null) return null; // no hay con que comparar: no se dice nada
  return { rowFit, colFit, transposed: colFit >= FIT_MIN && rowFit <= colFit - FIT_GAP };
}

// Revisa todas las tablas de la transcripcion contra el texto determinista de la pagina.
export function checkTableOrientation(plainText: string, aiMarkdown: string, symbols?: (s: string) => string): TableCheck {
  const out: TableCheck = { tables: 0, transposed: [], details: [] };
  const tables = extractMarkdownTables(aiMarkdown);
  if (tables.length === 0) return out;
  const lines = plainText
    .split('\n')
    .map((l) => normalizeCell(l, symbols))
    .filter((l) => l.length > 0);
  tables.forEach((t, i) => {
    const o = tableOrientation(t, lines, symbols);
    if (!o) return;
    out.tables++;
    out.details.push(o);
    if (o.transposed) out.transposed.push(i + 1);
  });
  return out;
}
