// Agrupa los chunks de un material en bloques para generar fichas: cada bloque va en UNA llamada al modelo.
// Los chunks consecutivos de una misma seccion se mantienen juntos cuando caben; el tope de bloques acota el
// costo/tiempo por material (la funcion tiene 300 s).

export interface ChunkInput {
  chunk_index: number;
  content: string;
}

export interface ChunkGroup {
  section: string | null;
  text: string;
  chunkIndexes: number[];
}

export const GROUP_TARGET_CHARS = 6000;
export const GROUP_MAX_CHARS = 9000;
export const MAX_GROUPS = 12;
const MIN_USEFUL_CHARS = 200;

const SECTION_RE = /^\[Secci[oó]n:\s*([^\]]+)\]/;

export function sectionOf(content: string): string | null {
  const m = content.trimStart().match(SECTION_RE);
  return m ? m[1].trim() : null;
}

// Quita el prefijo "[Seccion: ...]" que agrega el chunker: ya viaja aparte como titulo del bloque.
function stripSection(content: string): string {
  return content.replace(/^\s*\[Secci[oó]n:[^\]]*\]\s*/, '').trim();
}

function pack(chunks: ChunkInput[], limit: number): ChunkGroup[] {
  const groups: ChunkGroup[] = [];
  let cur: ChunkGroup | null = null;
  for (const c of chunks) {
    const text = stripSection(c.content);
    if (!text) continue;
    const section = sectionOf(c.content);
    if (cur && cur.text.length + text.length + 2 <= limit) {
      cur.text += `\n\n${text}`;
      cur.chunkIndexes.push(c.chunk_index);
      if (!cur.section) cur.section = section;
    } else {
      cur = { section, text, chunkIndexes: [c.chunk_index] };
      groups.push(cur);
    }
  }
  return groups;
}

export function groupChunks(chunks: ChunkInput[], maxGroups = MAX_GROUPS): ChunkGroup[] {
  const sorted = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  let groups = pack(sorted, GROUP_TARGET_CHARS);
  if (groups.length > maxGroups) {
    // Material largo: bloques mas grandes (hasta el tope) antes de descartar contenido.
    const total = sorted.reduce((n, c) => n + stripSection(c.content).length, 0);
    const limit = Math.min(GROUP_MAX_CHARS, Math.ceil(total / maxGroups) + 500);
    groups = pack(sorted, limit);
  }
  // Un bloque diminuto (p. ej. una linea suelta) no da para una ficha: se descarta, salvo que sea el unico.
  const useful = groups.filter((g) => g.text.length >= MIN_USEFUL_CHARS);
  return (useful.length > 0 ? useful : groups).slice(0, maxGroups);
}
