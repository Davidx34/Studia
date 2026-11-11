// AUDITOR ESTRICTO (memoria de calidad, medicion). El juez de produccion aprueba ~98 % de lo que genera el generador actual, asi que ya no puede mostrar si una regla o la doctrina
// mejoran algo (efecto techo, ver docs/IA_ARQUITECTURA_DE_MEMORIAS.md §9). Este auditor mide OTRA cosa, con DOS protocolos que no dependen del veredicto del juez:
//
//  1. RESOLUCION CIEGA: al modelo se le da la pregunta SIN la respuesta marcada ni la explicacion y se le pide resolverla. Si su respuesta no coincide con la marcada, la
//     pregunta es sospechosa. Es una verificacion independiente y objetiva (no un «¿te parece bien?»): solo para opcion multiple y verdadero/falso, donde la comparacion es exacta.
//  2. DEFECTOS ESTRICTOS: una lista de defectos concretos, cada uno con severidad y una CITA textual de la pregunta que lo demuestre. Sin cita, el defecto no cuenta
//     (frena la tendencia de los modelos a inventar defectos para parecer estrictos).
//
// Una pregunta queda «sospechosa» si la resolucion ciega discrepa o si tiene un defecto critico o mayor con cita. Es una MEDICION, no una decision: no cambia ninguna pregunta.
// Es una senal mas dura que el juez, no la verdad: la referencia sigue siendo la revision del profesor (ver exportMuestraCiega en scripts/audit-pool.ts).
import { geminiGenerate } from '@/lib/ai/geminiDirect';

export type Severity = 'critico' | 'mayor' | 'menor';
export interface AuditDefect {
  code: string;
  severity: Severity;
  quote: string;
  why: string;
}
export interface BlindSolve {
  /** Indice (opcion multiple) o booleano (verdadero/falso) que dio el auditor; null si no pudo resolverla. */
  answer: number | boolean | null;
  confident: boolean;
}
export interface AuditOutcome {
  /** false si el auditor no pudo dar resultado (infraestructura): NO cuenta ni a favor ni en contra. */
  audited: boolean;
  blindApplicable: boolean;
  blindMatches: boolean | null;
  defects: AuditDefect[];
  suspicious: boolean;
  reasons: string[];
}

const SEVERITIES: Severity[] = ['critico', 'mayor', 'menor'];

// Codigos de defecto: concretos y verificables contra el texto de la propia pregunta.
export const DEFECT_CODES: Record<string, string> = {
  respuesta_incorrecta: 'La respuesta marcada como correcta es falsa segun el conocimiento establecido de la materia.',
  mas_de_una_correcta: 'Mas de una opcion es defendible como correcta.',
  ninguna_correcta: 'Ninguna opcion es correcta.',
  dato_faltante: 'Para responder falta un dato que la pregunta no da (o depende de una imagen, un video o «el texto anterior»).',
  dato_inventado: 'Afirma como hechos datos, cifras o fuentes que no se pueden respaldar.',
  pista_accidental: 'Un distractor se delata por su redaccion (mucho mas largo/corto, error gramatical, absoluto como «siempre» o «nunca») o la propia pregunta revela la respuesta.',
  distractor_absurdo: 'Un distractor no es plausible: nadie con conocimiento parcial lo elegiria.',
  ambigua: 'El enunciado admite dos lecturas que cambian la respuesta.',
  trivial: 'Se responde sin conocer el tema (memoria de una palabra o sentido comun).',
  nivel_inadecuado: 'Pide algo muy por encima o por debajo del nivel declarado.',
  explicacion_contradice: 'La explicacion contradice la respuesta marcada o el enunciado.',
  calculo_erroneo: 'Un calculo del enunciado, de las opciones o de la explicacion esta mal.',
};

// «match» se audita por defectos (no tiene resolucion ciega): antes quedaba fuera y era invisible para el auditor.
const CLASSIC = new Set(['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'match']);
export const isAuditable = (q: any): boolean => CLASSIC.has(q?.type);
export const supportsBlindSolve = (q: any): boolean => (q?.type === 'multiple_choice' && Array.isArray(q.opts) && q.opts.length >= 2) || q?.type === 'true_false';

// Version de la pregunta SIN respuesta, ni explicacion, ni palabras clave: lo unico que ve el estudiante.
export function blindText(q: any): string {
  const parts = [`Tipo: ${q.type}`, `Pregunta: ${q.q}`];
  if (Array.isArray(q.opts)) parts.push('Opciones:\n' + q.opts.map((o: unknown, i: number) => `  ${i}) ${String(o)}`).join('\n'));
  if (q.type === 'true_false') parts.push('Responde si el enunciado es verdadero o falso.');
  return parts.join('\n');
}

// Version completa para la auditoria de defectos (con la respuesta marcada y la explicacion).
export function fullText(q: any): string {
  const parts = [blindText(q)];
  if (q.ok !== null && q.ok !== undefined) parts.push(`Respuesta marcada como correcta: ${JSON.stringify(q.ok)}`);
  if (q.answers) parts.push(`Respuestas aceptadas: ${JSON.stringify(q.answers)}`);
  if (q.keywords) parts.push(`Palabras clave esperadas: ${JSON.stringify(q.keywords)}`);
  if (q.pairs) parts.push(`Pares: ${JSON.stringify(q.pairs)}`);
  if (q.exp) parts.push(`Explicacion: ${q.exp}`);
  return parts.join('\n');
}

export function buildBlindPrompt(batch: any[], material: string): string {
  const numbered = batch.map((q, i) => `### PREGUNTA ${i + 1}\n${blindText(q)}`).join('\n\n');
  return `Eres un estudiante experto que resuelve un examen. RESUELVE cada pregunta TU MISMO, razonando y calculando con cuidado; no hay respuesta dada. Usa el material solo como contexto del curso: la verdad es el conocimiento establecido de la materia.

Para opcion multiple responde con el INDICE de la opcion (empezando en 0). Para verdadero/falso responde true o false. Si la pregunta no se puede resolver (falta un dato, es ambigua, hay varias correctas o ninguna), responde null y explica en "nota".

Responde SOLO con JSON: {"answers":[{"index":1,"answer":0,"confident":true,"nota":"..."}, ...]} con EXACTAMENTE ${batch.length} objetos, "index" = numero de PREGUNTA (1-based). "confident" es false si dudas.

MATERIAL DE REFERENCIA (contexto):
${(material || '').substring(0, 5000)}

${numbered}`;
}

export function parseBlind(text: string, n: number): BlindSolve[] | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    if (!Array.isArray(p.answers) || p.answers.length !== n) return null;
    const by = new Map<number, BlindSolve>();
    for (const a of p.answers) {
      const ans = a?.answer;
      by.set(a?.index, { answer: typeof ans === 'number' || typeof ans === 'boolean' ? ans : null, confident: a?.confident !== false });
    }
    return Array.from({ length: n }, (_, i) => by.get(i + 1) ?? { answer: null, confident: false });
  } catch {
    return null;
  }
}

export function buildDefectPrompt(batch: any[], material: string): string {
  const codes = Object.entries(DEFECT_CODES).map(([c, d]) => `- ${c}: ${d}`).join('\n');
  const numbered = batch.map((q, i) => `### PREGUNTA ${i + 1}\n${fullText(q)}`).join('\n\n');
  return `Eres un AUDITOR EXTERNO ESTRICTO de calidad de preguntas de evaluacion. Tu trabajo es encontrar defectos reales; un auditor que aprueba todo no sirve, pero uno que inventa defectos tampoco.

REGLAS:
- Verifica TU la respuesta marcada de forma independiente (razona, calcula, comprueba cada opcion). No des por buena la explicacion que trae.
- Reporta SOLO defectos de esta lista, con su codigo exacto:
${codes}
- Severidad: "critico" = la pregunta daria una respuesta equivocada o imposible a un estudiante que sabe el tema (respuesta_incorrecta, mas_de_una_correcta, ninguna_correcta, dato_faltante, calculo_erroneo); "mayor" = el estudiante puede acertar o fallar por una razon ajena al conocimiento (pista_accidental, ambigua, explicacion_contradice, dato_inventado); "menor" = mejorable pero usable (distractor_absurdo, trivial, nivel_inadecuado).
- CADA defecto debe traer "quote": un fragmento TEXTUAL (≤ 120 caracteres) copiado de la pregunta, las opciones o la explicacion que lo demuestre, y "why": una frase. Sin cita textual, NO lo reportes.
- Una pregunta sin defectos devuelve "defects": []. Que algo no aparezca en el material NO es defecto si es correcto en la materia.

Responde SOLO con JSON: {"audits":[{"index":1,"defects":[{"code":"...","severity":"critico|mayor|menor","quote":"...","why":"..."}]}, ...]} con EXACTAMENTE ${batch.length} objetos, "index" = numero de PREGUNTA (1-based).

MATERIAL DE REFERENCIA (contexto):
${(material || '').substring(0, 5000)}

${numbered}`;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function parseDefects(text: string, batch: any[]): AuditDefect[][] | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    if (!Array.isArray(p.audits) || p.audits.length !== batch.length) return null;
    const by = new Map<number, AuditDefect[]>();
    for (const a of p.audits) {
      const q = batch[(a?.index ?? 0) - 1];
      if (!q || !Array.isArray(a.defects)) continue;
      const hay = norm(fullText(q));
      const ok: AuditDefect[] = [];
      for (const d of a.defects) {
        const quote = String(d?.quote ?? '').trim();
        // Defecto valido: codigo conocido, severidad valida y CITA realmente presente en la pregunta (las citas inventadas no cuentan).
        if (!(d?.code in DEFECT_CODES) || !SEVERITIES.includes(d?.severity) || quote.length < 6) continue;
        if (!hay.includes(norm(quote).slice(0, 60))) continue;
        ok.push({ code: d.code, severity: d.severity, quote: quote.slice(0, 160), why: String(d.why ?? '').slice(0, 240) });
      }
      by.set(a.index, ok);
    }
    return batch.map((_, i) => by.get(i + 1) ?? []);
  } catch {
    return null;
  }
}

export function combine(q: any, blind: BlindSolve | null, defects: AuditDefect[] | null): AuditOutcome {
  const blindApplicable = supportsBlindSolve(q);
  let blindMatches: boolean | null = null;
  if (blindApplicable && blind && blind.answer !== null) blindMatches = blind.answer === q.ok;
  const reasons: string[] = [];
  if (blindMatches === false) reasons.push(`resolucion ciega discrepa (auditor: ${JSON.stringify(blind!.answer)}, marcada: ${JSON.stringify(q.ok)})`);
  // Si el auditor no pudo resolverla (null) siendo aplicable, tampoco cuenta como fallo: puede ser ambigua, pero eso lo captura la lista de defectos.
  const serious = (defects ?? []).filter((d) => d.severity !== 'menor');
  for (const d of serious) reasons.push(`${d.severity}: ${d.code} — «${d.quote}»`);
  const audited = defects !== null || (blindApplicable && blind !== null);
  return { audited, blindApplicable, blindMatches, defects: defects ?? [], suspicious: audited && reasons.length > 0, reasons };
}

async function ask(prompt: string): Promise<string | null> {
  const r = await geminiGenerate({ role: 'judge', parts: [{ text: prompt }], generationConfig: { temperature: 0, responseMimeType: 'application/json' }, thinking: 'default', retries: 2 });
  return r.ok ? r.text : null;
}

const AUDIT_BATCH = 5;
const AUDIT_CONCURRENCY = 4;

/** Audita preguntas clasicas. Devuelve un resultado por id; las que el auditor no pudo auditar (infraestructura) vienen con audited=false. */
export async function auditQuestions(questions: any[], material: string): Promise<Map<string, AuditOutcome>> {
  const out = new Map<string, AuditOutcome>();
  const qs = questions.filter(isAuditable);
  const batches: any[][] = [];
  for (let i = 0; i < qs.length; i += AUDIT_BATCH) batches.push(qs.slice(i, i + AUDIT_BATCH));
  // Los lotes son independientes: se auditan en paralelo (con tope) porque el modelo piensa y cada llamada tarda decenas de segundos.
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const solvable = batch.filter(supportsBlindSolve);
      const [bt, dt] = await Promise.all([solvable.length > 0 ? ask(buildBlindPrompt(solvable, material)) : Promise.resolve(null), ask(buildDefectPrompt(batch, material))]);
      const blinds = bt ? parseBlind(bt, solvable.length) : null;
      const defects = dt ? parseDefects(dt, batch) : null;
      batch.forEach((q, j) => {
        const k = solvable.indexOf(q);
        out.set(q.id, combine(q, k >= 0 && blinds ? blinds[k] : null, defects ? defects[j] : null));
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(AUDIT_CONCURRENCY, batches.length) }, worker));
  return out;
}
