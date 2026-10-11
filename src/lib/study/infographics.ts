// Infografias a partir de datos estructurados (paso 5). El modelo NO dibuja: devuelve una estructura y la app la
// pinta. Eso permite verificarla contra el material (cada cifra y cada texto deben salir de el), tematizarla y
// hacerla accesible.

import type { ChunkGroup } from './grouping';
import type { ModelCaller } from './generate';
import { extractJsonObject, groundedRatio, MIN_GROUNDING } from './validate';

export type InfographicType = 'timeline' | 'comparison' | 'process' | 'stats';

export type Infographic =
  | { tipo: 'timeline'; titulo: string; eventos: { cuando: string; titulo: string; detalle: string }[] }
  | { tipo: 'comparison'; titulo: string; columnas: string[]; filas: { criterio: string; valores: string[] }[] }
  | { tipo: 'process'; titulo: string; pasos: { titulo: string; detalle: string }[] }
  | { tipo: 'stats'; titulo: string; cifras: { valor: string; etiqueta: string; nota: string }[] };

export const INFOGRAPHIC_LABEL: Record<InfographicType, string> = {
  timeline: 'Línea de tiempo',
  comparison: 'Comparativa',
  process: 'Proceso',
  stats: 'Cifras clave',
};

const MAX_INFOGRAPHIC_GROUPS = 6;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Numeros del texto sin separadores ("3.181" y "3181" son lo mismo).
function numbersIn(s: string): string[] {
  return (s.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/[.,]+$/, '').replace(/[.,]/g, ''));
}

// Una cifra solo vale si aparece literalmente en el material: ahi es donde un modelo inventa con mas facilidad.
function figureInSource(valor: string, source: string): boolean {
  const nums = numbersIn(valor);
  if (nums.length === 0) return groundedRatio(valor, source) >= MIN_GROUNDING;
  const src = new Set(numbersIn(source));
  return nums.every((n) => src.has(n));
}

function textOf(parts: string[]): string {
  return parts.filter(Boolean).join(' ');
}

export function validateInfographic(raw: any, source: string): Infographic | null {
  if (!raw || typeof raw !== 'object') return null;
  const tipo = raw.tipo as InfographicType;
  const titulo = str(raw.titulo, 120);
  if (titulo.length < 3) return null;

  if (tipo === 'timeline') {
    const eventos = (Array.isArray(raw.eventos) ? raw.eventos : [])
      .map((e: any) => ({ cuando: str(e?.cuando, 40), titulo: str(e?.titulo, 100), detalle: str(e?.detalle, 220) }))
      .filter((e: { cuando: string; titulo: string }) => e.cuando.length >= 1 && e.titulo.length >= 3)
      .slice(0, 8);
    if (eventos.length < 3) return null;
    // Las fechas deben salir del material.
    if (!eventos.every((e: { cuando: string }) => figureInSource(e.cuando, source))) return null;
    if (groundedRatio(textOf(eventos.map((e: { titulo: string; detalle: string }) => `${e.titulo} ${e.detalle}`)), source) < MIN_GROUNDING) return null;
    return { tipo, titulo, eventos };
  }

  if (tipo === 'comparison') {
    const columnas = (Array.isArray(raw.columnas) ? raw.columnas : []).map((c: unknown) => str(c, 60)).filter((c: string) => c.length >= 2).slice(0, 3);
    if (columnas.length < 2) return null;
    const filas = (Array.isArray(raw.filas) ? raw.filas : [])
      .map((f: any) => ({
        criterio: str(f?.criterio, 80),
        valores: (Array.isArray(f?.valores) ? f.valores : []).slice(0, columnas.length).map((v: unknown) => str(v, 160)),
      }))
      // Cada fila debe tener un valor por columna, todos con contenido.
      .filter((f: { criterio: string; valores: string[] }) => f.criterio.length >= 2 && f.valores.length === columnas.length && f.valores.every((v: string) => v.length >= 1))
      .slice(0, 6);
    if (filas.length < 2) return null;
    const all = textOf([...columnas, ...filas.flatMap((f: { criterio: string; valores: string[] }) => [f.criterio, ...f.valores])]);
    if (groundedRatio(all, source) < MIN_GROUNDING) return null;
    return { tipo, titulo, columnas, filas };
  }

  if (tipo === 'process') {
    const pasos = (Array.isArray(raw.pasos) ? raw.pasos : [])
      .map((p: any) => ({ titulo: str(p?.titulo, 100), detalle: str(p?.detalle, 220) }))
      .filter((p: { titulo: string }) => p.titulo.length >= 3)
      .slice(0, 7);
    if (pasos.length < 3) return null;
    if (groundedRatio(textOf(pasos.map((p: { titulo: string; detalle: string }) => `${p.titulo} ${p.detalle}`)), source) < MIN_GROUNDING) return null;
    return { tipo, titulo, pasos };
  }

  if (tipo === 'stats') {
    const cifras = (Array.isArray(raw.cifras) ? raw.cifras : [])
      .map((c: any) => ({ valor: str(c?.valor, 30), etiqueta: str(c?.etiqueta, 100), nota: str(c?.nota, 160) }))
      .filter((c: { valor: string; etiqueta: string }) => c.valor.length >= 1 && c.etiqueta.length >= 3)
      .filter((c: { valor: string }) => figureInSource(c.valor, source))
      .slice(0, 6);
    if (cifras.length < 2) return null;
    return { tipo, titulo, cifras };
  }

  return null;
}

export function buildInfographicPrompt(group: ChunkGroup, materialName: string): string {
  return `Eres un disenador de material de estudio. A partir de UN fragmento de apuntes, decide si se puede resumir en una infografia y devuelve SUS DATOS (no la dibujes).
Material: "${materialName}"${group.section ? `\nSeccion: "${group.section}"` : ''}

Elige UN tipo, el que mejor encaje con el fragmento:
- "timeline": hechos con fechas o epocas (minimo 3 eventos, cada uno con su fecha).
- "comparison": dos o tres conceptos comparados por varios criterios (minimo 2 criterios).
- "process": una secuencia de pasos o etapas (minimo 3 pasos).
- "stats": cifras o datos numericos importantes (minimo 2).

REGLAS
- Usa SOLO informacion del fragmento. Fechas, numeros y nombres deben aparecer tal cual en el fragmento.
- El titulo debe nombrar el tema CONCRETO del fragmento (nada generico como "Eventos clave").
- Textos cortos, en espanol. Nada de relleno.
- Si el fragmento no se presta a ninguna infografia, responde {"infografia":null}.

Responde SOLO con JSON valido con UNA de estas formas:
{"infografia":{"tipo":"timeline","titulo":"...","eventos":[{"cuando":"...","titulo":"...","detalle":"..."}]}}
{"infografia":{"tipo":"comparison","titulo":"...","columnas":["A","B"],"filas":[{"criterio":"...","valores":["...","..."]}]}}
{"infografia":{"tipo":"process","titulo":"...","pasos":[{"titulo":"...","detalle":"..."}]}}
{"infografia":{"tipo":"stats","titulo":"...","cifras":[{"valor":"...","etiqueta":"...","nota":"..."}]}}

FRAGMENTO
${group.text}`;
}

export interface GeneratedInfographics {
  items: (Infographic & { section: string | null })[];
  groupsTried: number;
  // Motivos de los bloques sin infografia: noResponse (el modelo no contesto), rejected (contesto algo que no paso la
  // verificacion contra el material), noFit (el fragmento no se presta: respuesta legitima), skipped (tiempo).
  noResponse: number;
  rejected: number;
  noFit: number;
  skipped: number;
}

// Un bloque por llamada; reparte los bloques elegidos a lo largo del material (no solo el principio).
// Dos infografias que cuentan lo mismo (mismas fechas, o mismo titulo) se reducen a la primera.
function signature(i: Infographic): Set<string> {
  if (i.tipo === 'timeline') return new Set(i.eventos.map((e) => fold(e.cuando).replace(/[^a-z0-9]/g, '')));
  if (i.tipo === 'stats') return new Set(i.cifras.map((c) => fold(c.valor).replace(/[^a-z0-9]/g, '')));
  return new Set([fold(i.titulo).replace(/[^a-z0-9]/g, '')]);
}

export function isDuplicate(a: Infographic, b: Infographic): boolean {
  if (a.tipo !== b.tipo) return false;
  const sa = signature(a);
  const sb = signature(b);
  let common = 0;
  sa.forEach((x) => {
    if (sb.has(x)) common++;
  });
  return common / Math.min(sa.size, sb.size) >= 0.5;
}

export function pickGroups(groups: ChunkGroup[], max = MAX_INFOGRAPHIC_GROUPS): ChunkGroup[] {
  if (groups.length <= max) return groups;
  const step = groups.length / max;
  return Array.from({ length: max }, (_, i) => groups[Math.floor(i * step)]);
}

export async function generateInfographics(
  groups: ChunkGroup[],
  materialName: string,
  call: ModelCaller,
  concurrency = 2,
  deadline: number = Infinity
): Promise<GeneratedInfographics> {
  const chosen = pickGroups(groups);
  const results: (Infographic | null)[] = new Array(chosen.length).fill(null);
  const why: ('noResponse' | 'rejected' | 'noFit' | 'skipped' | null)[] = new Array(chosen.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (true) {
      const idx = next++;
      if (idx >= chosen.length) return;
      if (Date.now() > deadline) {
        why[idx] = 'skipped';
        continue;
      }
      let answered = false;
      for (let attempt = 0; attempt < 2 && !results[idx]; attempt++) {
        const text = await call(buildInfographicPrompt(chosen[idx], materialName));
        if (!text) continue;
        answered = true;
        const parsed = extractJsonObject(text);
        // {"infografia":null} es una respuesta valida ("no se presta"): no se reintenta.
        if (parsed && parsed.infografia === null) {
          why[idx] = 'noFit';
          break;
        }
        results[idx] = validateInfographic(parsed?.infografia, chosen[idx].text);
      }
      if (!results[idx] && why[idx] === null) why[idx] = answered ? 'rejected' : 'noResponse';
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chosen.length) }, worker));
  const out: GeneratedInfographics = { items: [], groupsTried: chosen.length, noResponse: 0, rejected: 0, noFit: 0, skipped: 0 };
  results.forEach((r, i) => {
    if (r && !out.items.some((x) => isDuplicate(x, r))) out.items.push({ ...r, section: chosen[i].section });
    else if (!r && why[i]) out[why[i] as 'noResponse' | 'rejected' | 'noFit' | 'skipped']++;
  });
  return out;
}

export function infographicRow(materialId: string, item: Infographic & { section: string | null }, position: number) {
  const { section, ...data } = item;
  return {
    material_id: materialId,
    kind: 'infografia' as const,
    section,
    position,
    front: item.titulo,
    back: INFOGRAPHIC_LABEL[item.tipo],
    extra: data,
  };
}
