// Fase 5 de «IA que aprende»: ruta de investigacion con fuentes (Gemini + busqueda de Google).
//
// Reglas del diseno (docs/IA_APRENDIZAJE_CONTINUO.md §5):
//   - Las fuentes externas son SUGERENCIAS del profesor, no material del curso: se muestran con enlace y NO entran al RAG.
//   - Cada afirmacion se cita o se marca «sin fuente». Gemini devuelve que fragmento del texto respalda cada fuente (groundingSupports); lo que no tiene respaldo no se presenta como hecho.
//   - Las fuentes se resuelven y se comprueba si responden. Un enlace roto se marca; uno que no se pudo comprobar tambien (muchos sitios bloquean a los robots): nunca se afirma mas de lo medido.
// Este modulo es puro salvo resolveSources (recibe fetch). El texto que vuelve de la web solo se MUESTRA al profesor como texto plano; nunca se ejecuta ni se pasa a otra llamada de IA.

export interface GroundingChunk {
  uri: string;
  title: string;
}
export interface GroundingSupport {
  start: number;
  end: number;
  chunks: number[];
}
export interface Grounding {
  queries: string[];
  chunks: GroundingChunk[];
  supports: GroundingSupport[];
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Extrae lo util de groundingMetadata, tolerando cualquier forma inesperada. */
export function extractGrounding(raw: unknown): Grounding {
  const g = (raw ?? {}) as any;
  const chunks: GroundingChunk[] = (Array.isArray(g.groundingChunks) ? g.groundingChunks : [])
    .map((c: any) => ({ uri: str(c?.web?.uri, 2000), title: str(c?.web?.title, 200) }))
    .filter((c: GroundingChunk) => c.uri);
  const supports: GroundingSupport[] = (Array.isArray(g.groundingSupports) ? g.groundingSupports : [])
    .map((s: any) => ({
      start: int(s?.segment?.startIndex),
      end: int(s?.segment?.endIndex),
      chunks: (Array.isArray(s?.groundingChunkIndices) ? s.groundingChunkIndices : []).filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < chunks.length),
    }))
    .filter((s: GroundingSupport) => s.end > s.start && s.chunks.length > 0);
  const queries = (Array.isArray(g.webSearchQueries) ? g.webSearchQueries : []).map((q: unknown) => str(q, 200)).filter(Boolean).slice(0, 10);
  return { queries, chunks, supports };
}

/** Texto plano para mostrar: sin etiquetas HTML, sin caracteres de control, con tope de largo. */
export function sanitizeDisplayText(text: string, max = 8000): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, max);
}

/**
 * Inserta marcas [n] al final de cada fragmento respaldado. Los indices de Gemini son BYTES UTF-8 (no caracteres: las tildes ocupan 2), asi que se trabaja sobre bytes.
 * Devuelve tambien que fraccion del texto (en bytes, sin contar espacios) tiene respaldo.
 */
export function annotateCitations(text: string, supports: GroundingSupport[]): { annotated: string; citedRatio: number } {
  const bytes = Buffer.from(text, 'utf8');
  const covered = new Uint8Array(bytes.length);
  const marks = new Map<number, Set<number>>();
  for (const s of supports) {
    const end = Math.min(s.end, bytes.length);
    for (let i = Math.min(s.start, end); i < end; i++) covered[i] = 1;
    // No partir un caracter: si el corte cae dentro de uno, se avanza hasta su final.
    let at = end;
    while (at < bytes.length && (bytes[at] & 0xc0) === 0x80) at++;
    const set = marks.get(at) ?? new Set<number>();
    s.chunks.forEach((c) => set.add(c + 1));
    marks.set(at, set);
  }
  let total = 0;
  let cited = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09) continue;
    total++;
    if (covered[i]) cited++;
  }
  const parts: Buffer[] = [];
  let prev = 0;
  for (const at of Array.from(marks.keys()).sort((a, b) => a - b)) {
    parts.push(bytes.subarray(prev, at), Buffer.from(' ' + Array.from(marks.get(at)!).sort((a, b) => a - b).map((n) => `[${n}]`).join('')));
    prev = at;
  }
  parts.push(bytes.subarray(prev));
  return { annotated: Buffer.concat(parts).toString('utf8'), citedRatio: total ? Math.round((cited / total) * 100) / 100 : 0 };
}

/** Solo http(s) publico: sin credenciales, sin localhost ni direcciones IP (evita apuntar al servidor a redes internas). */
export function safePublicUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.startsWith('[')) return null;
  return u.toString();
}

export type Reach = 'ok' | 'broken' | 'unchecked';
export interface ResolvedSource {
  n: number;
  title: string;
  url: string | null;
  reach: Reach;
}

const REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

export interface ResolveDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Resuelve cada fuente a su URL real y comprueba si responde. Los enlaces de Google (redirect) se resuelven leyendo UNA redireccion sin seguirla; luego un HEAD con redireccion manual a la URL
 * publica. 2xx/3xx = ok; 404/410 o sin respuesta = broken; 401/403/405/429 = unchecked (el sitio bloquea robots; no significa que este roto).
 */
export async function resolveSources(chunks: GroundingChunk[], deps: ResolveDeps = {}): Promise<ResolvedSource[]> {
  const doFetch = deps.fetchImpl ?? fetch;
  const timeout = deps.timeoutMs ?? 5000;
  const one = async (c: GroundingChunk, i: number): Promise<ResolvedSource> => {
    const n = i + 1;
    let target: string | null = null;
    try {
      const first = safePublicUrl(c.uri);
      if (!first) return { n, title: c.title, url: null, reach: 'unchecked' };
      if (new URL(first).hostname === REDIRECT_HOST) {
        const r = await doFetch(first, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeout) });
        const loc = r.headers.get('location');
        target = loc ? safePublicUrl(new URL(loc, first).toString()) : null;
        if (!target) return { n, title: c.title, url: null, reach: 'unchecked' };
      } else target = first;
      const h = await doFetch(target, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeout) });
      const st = h.status;
      const reach: Reach = st >= 200 && st < 400 ? 'ok' : st === 404 || st === 410 ? 'broken' : 'unchecked';
      return { n, title: c.title, url: target, reach };
    } catch {
      // Sin respuesta: si ya tenemos la URL real se marca rota; si no, no se pudo comprobar.
      return { n, title: c.title, url: target, reach: target ? 'broken' : 'unchecked' };
    }
  };
  return Promise.all(chunks.slice(0, 12).map(one));
}

export const QUESTION_TYPES_FOR_PROMPT = ['opción múltiple', 'verdadero o falso', 'completar frase', 'respuesta corta', 'emparejar'];

const oneLine = (s: string, max: number) => s.replace(/[\r\n\t]+/g, ' ').replace(/[`#<>]/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, max);

export interface ResearchInput {
  topic: string;
  className?: string;
  subject?: string;
  level?: string;
}

export function buildResearchPrompt(i: ResearchInput): string {
  const ctx = [i.className && `Clase: ${oneLine(i.className, 80)}`, i.subject && `Materia: ${oneLine(i.subject, 60)}`, i.level && `Nivel: ${oneLine(i.level, 40)}`].filter(Boolean).join('\n');
  return `Eres el asistente de investigación de un profesor. Busca en la web y prepárale una ruta para profundizar en un tema. Responde en español, en texto plano.
${ctx ? ctx + '\n' : ''}TEMA: ${oneLine(i.topic, 120)}

Entrega, con estos títulos exactos:
LECTURAS: 3 recursos REALES que hayas encontrado (autor o institución, título), cada uno con una línea de por qué sirve.
PREGUNTAS GUÍA: 3 preguntas para orientar la investigación o la clase.
ESTILO DE PREGUNTA RECOMENDADO: elige UNO de (${QUESTION_TYPES_FOR_PROMPT.join(', ')}) para evaluar este tema y explica en una línea por qué.
ADVERTENCIAS: errores comunes o puntos donde las fuentes no coinciden.

No inventes libros, autores ni datos. Si no encuentras algo, escribe «no encontré una fuente confiable». Todo lo que afirmes debe poder respaldarse con lo que encontraste.`;
}
