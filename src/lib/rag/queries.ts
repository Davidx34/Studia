// Consultas con las que se busca el contexto de un modulo. Antes era UNA ("titulo. descripcion"); una sola formulacion
// pierde fragmentos que hablan del tema con otras palabras. Se arman hasta 3 variantes distintas SIN llamar a ningun modelo
// (cero costo de cuota): la descripcion completa, las palabras clave del modulo y el titulo solo.

export interface ModuleQueryInput {
  title: string;
  description?: string | null;
  keywords?: string[] | null;
}

const MAX_VARIANTS = 3;
const MAX_CHARS = 400;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);

export function buildQueryVariants(m: ModuleQueryInput): string[] {
  const title = clean(m.title ?? '');
  const desc = clean(m.description ?? '');
  const keywords = (m.keywords ?? []).map((k) => clean(String(k))).filter(Boolean);

  const candidates = [
    // 1. Lo de siempre: es la linea base y mantiene el comportamiento anterior como una de las consultas.
    clean(`${title}. ${desc}`),
    // 2. Palabras clave: vocabulario del tema sin relleno.
    keywords.length >= 2 ? clean(keywords.join(', ')) : '',
    // 3. Solo el titulo: la formulacion mas corta y precisa.
    title,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (!c || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_VARIANTS) break;
  }
  return out;
}
