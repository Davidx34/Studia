// Etapa 2 (Chunking) del pipeline de ingesta de materiales — ver la skill
// .claude/skills/ai-content-pipeline-architect/SKILL.md para el framework
// completo. Este modulo extiende el chunking generico por parrafos/oraciones
// (que ya vivia en textProcessing.ts) con dos mejoras especificas para
// contenido con estructura Markdown real (pegado de NotebookLM, materiales
// de texto ya formateados, etc.):
//
// 1. NUNCA parte una tabla ni un bloque de codigo a la mitad entre dos
//    chunks. El embedding de media tabla es ruido semantico, y el LLM
//    generador que reciba solo esa mitad tiende a "completar" la otra con
//    conocimiento general -- exactamente el patron de alucinacion que
//    ANTI_HALLUCINATION_BLOCK (cohereGeneration.ts) previene aguas abajo.
//    Esto lo previene aguas arriba, en el origen del problema.
// 2. Cuando el material tiene headings (#, ##, ###...), cada chunk que cae
//    dentro de una seccion lleva un prefijo con la ruta de esa seccion (ej:
//    "[Sección: Unidad 2 > Teoría del Consumidor > Utilidad Marginal]").
//    Es contexto semantico gratis (ya etiquetado por el autor del material,
//    no inferido por ningun LLM) que mejora la similitud del embedding Y le
//    da al LLM generador algo concreto que citar para el criterio de
//    "ANCLAJE" del juez (judge.ts).
//
// Para texto SIN headings/tablas/bloques de codigo -- el caso de PDFs
// extraidos y transcripciones de YouTube, que llegan como texto plano -- el
// resultado es IDENTICO byte a byte al chunking generico anterior (ver
// textProcessing.test.ts, que sigue pasando sin cambios: ese es exactamente
// el camino que toma texto sin estructura). Este modulo es un superset
// estricto, no un reemplazo con comportamiento distinto.

export interface MarkdownSegment {
  text: string;
  /** Tabla o bloque de codigo: nunca se sub-divide, aunque exceda el tamaño objetivo. */
  atomic: boolean;
  /** Ruta de encabezados activa en este punto (ej: ["Unidad 2", "Teoría del Consumidor"]). */
  headingPath: string[];
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/;
const FENCE_RE = /^(```|~~~)/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

// Divide el texto en "segmentos": parrafos normales (separados por linea en
// blanco, igual que el split original por \n\s*\n) salvo que un bloque de
// codigo o una tabla Markdown se agrupan como UN solo segmento atomico sin
// importar cuantas lineas en blanco quedarian de por medio segun las reglas
// normales de parrafo. Los headings no se emiten como contenido propio --
// quedan representados en el headingPath de los segmentos que le siguen.
export function segmentMarkdown(text: string): MarkdownSegment[] {
  const lines = text.split('\n');
  const segments: MarkdownSegment[] = [];
  const headingStack: { level: number; title: string }[] = [];

  let buffer: string[] = [];

  const currentPath = () => headingStack.map((h) => h.title);

  function flushBuffer() {
    // OJO: no usar .trim() sobre el contenido -- el chunking original (antes
    // de este modulo) tampoco tocaba el contenido interno del parrafo, solo
    // los separadores de linea en blanco. Recortar aqui cambiaria el texto
    // real del material (ej. un espacio final de una oracion) de forma
    // silenciosa, que es exactamente el tipo de alteracion invisible que la
    // etapa de Ingesta debe evitar (ver checklist de la skill).
    const joined = buffer.join('\n');
    if (joined.trim().length > 0) {
      segments.push({ text: joined, atomic: false, headingPath: currentPath() });
    }
    buffer = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flushBuffer();
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
      i++;
      continue;
    }

    if (FENCE_RE.test(line.trim())) {
      flushBuffer();
      const fenceLines = [line];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i].trim())) {
        fenceLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        fenceLines.push(lines[i]); // fence de cierre
        i++;
      }
      segments.push({ text: fenceLines.join('\n'), atomic: true, headingPath: currentPath() });
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      flushBuffer();
      const tableLines = [line];
      i++;
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      segments.push({ text: tableLines.join('\n'), atomic: true, headingPath: currentPath() });
      continue;
    }

    if (line.trim() === '') {
      flushBuffer();
      i++;
      continue;
    }

    buffer.push(line);
    i++;
  }
  flushBuffer();

  return segments;
}

function headingPrefix(path: string[]): string {
  if (path.length === 0) return '';
  return `[Sección: ${path.join(' > ')}]\n\n`;
}

function withPrefix(content: string, path: string[]): string {
  const prefix = headingPrefix(path);
  return prefix ? `${prefix}${content}` : content;
}

// Empaqueta segmentos en chunks respetando targetChars, sin partir nunca un
// segmento atomico (tabla/codigo), y sub-dividiendo por oraciones los
// segmentos NO atomicos que por si solos exceden el objetivo -- mismo
// criterio y mismo algoritmo de "cola de overlap" que el chunkText generico
// anterior, aplicado ahora a segmentos con conciencia de tabla/codigo/
// encabezado en vez de parrafos crudos.
export function packSegments(
  segments: MarkdownSegment[],
  targetChars: number,
  overlapChars: number
): string[] {
  const chunks: string[] = [];
  let buffer = '';
  let bufferPath: string[] = [];
  // Si el ultimo contenido agregado al buffer fue una tabla/bloque de codigo,
  // la "cola de overlap" (ver mas abajo) NUNCA debe tomarse del final del
  // buffer: cortar los ultimos N caracteres de una tabla es EXACTAMENTE la
  // corrupcion a medias que este modulo existe para evitar (fila sin su
  // encabezado, reinsertada sin contexto en el chunk siguiente -- bug real
  // encontrado al verificar con una muestra realista, no un caso hipotetico).
  let bufferEndsWithAtomic = false;

  for (const seg of segments) {
    const p = seg.text;

    if (buffer.length + p.length + 2 <= targetChars) {
      if (buffer.length === 0) bufferPath = seg.headingPath;
      buffer = buffer ? `${buffer}\n\n${p}` : p;
      bufferEndsWithAtomic = seg.atomic;
      continue;
    }

    if (buffer.length > 0) chunks.push(withPrefix(buffer, bufferPath));

    if (!seg.atomic && p.length > targetChars) {
      // Parrafo normal mas grande que el objetivo: sub-dividir por oraciones.
      const sentences = p.split(/(?<=[.!?])\s+/);
      let sb = '';
      for (const s of sentences) {
        if (sb.length + s.length + 1 <= targetChars) {
          sb = sb ? `${sb} ${s}` : s;
        } else {
          if (sb.length > 0) chunks.push(withPrefix(sb, seg.headingPath));
          sb = s;
        }
      }
      buffer = sb;
      bufferPath = seg.headingPath;
      bufferEndsWithAtomic = false;
    } else if (seg.atomic || bufferEndsWithAtomic) {
      // Tabla/codigo que no cupo (nunca se sub-divide, aunque exceda el
      // objetivo -- preferible un chunk un poco mas grande que una tabla
      // corrupta a medias), O el buffer que se acaba de cerrar terminaba en
      // una tabla/codigo (no hay una cola segura que tomar de ahi). En
      // ambos casos se arranca el chunk siguiente limpio, sin overlap.
      buffer = p;
      bufferPath = seg.headingPath;
      bufferEndsWithAtomic = seg.atomic;
    } else {
      // Parrafo normal que no cupo en el buffer, y el buffer anterior
      // terminaba en prosa normal (segura de fragmentar): arranca el chunk
      // siguiente con una "cola" de overlap del chunk que se acaba de
      // cerrar, para no perder continuidad semantica en el corte (mismo
      // criterio que el chunkText generico anterior).
      const tail = buffer.slice(-overlapChars);
      buffer = tail ? `${tail}\n\n${p}` : p;
      bufferPath = seg.headingPath;
      bufferEndsWithAtomic = false;
    }
  }
  if (buffer.length > 0) chunks.push(withPrefix(buffer, bufferPath));

  return chunks;
}

// Punto de entrada combinado: segmenta y empaqueta en un solo paso. Esta es
// la funcion que textProcessing.ts usa para implementar chunkText.
export function chunkMarkdownAware(text: string, targetChars: number, overlapChars: number): string[] {
  const segments = segmentMarkdown(text);
  return packSegments(segments, targetChars, overlapChars);
}
