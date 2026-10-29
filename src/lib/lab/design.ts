// Diseño de un laboratorio A PARTIR DE LA MEMORIA DE LA CLASE. En vez de elegir una plantilla fija, la IA describe el modelo del experimento (variables, formulas, escena) con lo
// que los materiales de la clase realmente explican. El flujo, en dos pasos y con un reintento guiado:
//   1. REQUISITOS: la IA dice que conceptos hacen falta para lo pedido. Se comparan con la memoria (prueba de suficiencia): si lo esencial no esta en los materiales, NO se crea
//      nada a medias; se dice que falta. Si solo cubre una parte, se avisa y el profesor decide.
//   2. DISEÑO: con los conceptos y formulas de la memoria (y ejemplos del formato) la IA escribe el modelo. Todo pasa por validateLabSpec (incluida la prueba numerica); si falla,
//      el error exacto se le devuelve a la IA para que se corrija (hasta 3 intentos). Al final se registra en que conceptos de la memoria se apoya.
// La IA nunca escribe codigo: solo datos que se validan. Sin red: el modelo se inyecta.

import { extractJsonObject } from '@/lib/study/validate';
import { buildIndex, prerequisitesOf, searchConcepts } from '@/lib/memory/graph';
import { sanitizeText } from './sanitize';
import { assessCoverage, explainCoverage, type Coverage, type Requirement } from '@/lib/memory/sufficiency';
import { KIND_LABEL, type Concept, type Graph, type SourceRef } from '@/lib/memory/types';
import { Expr, MODEL_LIMITS } from './model';
import { MODEL_EXAMPLES } from './modelExamples';
import { validateLabSpec } from './labSpec';
import { repairModel } from './repair';
import type { LabSpec } from './types';

export type ModelCaller = (prompt: string) => Promise<string | null>;

export const DESIGN_LIMITS = {
  idea: 800,
  // Conceptos de la memoria que se muestran a la IA para elegir requisitos y para disenar.
  catalog: 120,
  relevant: 25,
  requirements: 8,
  attempts: 3,
  evidence: 8,
  // Un concepto de la memoria se considera "el mismo" que un nombre citado con esta coincidencia.
  cite: 0.6,
} as const;

export interface Evidence {
  key: string;
  name: string;
  kind: Concept['kind'];
  definition: string;
  formula: string;
  sources: SourceRef[];
}

export type DesignFailure = 'noResponse' | 'unparseable' | 'noFit' | 'insufficient' | 'partial' | 'invalid';

export type DesignResult =
  | { ok: true; spec: LabSpec; warnings: string[]; evidence: Evidence[]; coverage: Coverage }
  | { ok: false; reason: DesignFailure; message: string; coverage?: Coverage };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// Los conceptos mas importantes de la memoria, para que la IA use SUS nombres.
export function memoryCatalog(graph: Graph, max: number = DESIGN_LIMITS.catalog): Concept[] {
  return graph.concepts
    .slice()
    .sort((a, b) => b.importance * 10 + b.mentions - (a.importance * 10 + a.mentions) || (a.key < b.key ? -1 : 1))
    .slice(0, max);
}

// ───────────────────────────── paso 1: requisitos ─────────────────────────────

export function buildRequirementsPrompt(idea: string, graph: Graph): string {
  const list = memoryCatalog(graph)
    .map((c) => `- ${c.name} [${KIND_LABEL[c.kind]}]${c.formula ? ' (tiene fórmula)' : ''}`)
    .join('\n');
  const text = sanitizeText(idea, DESIGN_LIMITS.idea);
  return `Eres un profesor que va a crear un experimento de laboratorio NUMÉRICO (variables que se mueven y resultados que se calculan) para su clase.

LO QUE PIDE EL PROFESOR: ${text}

LO QUE LOS MATERIALES DE LA CLASE EXPLICAN (conceptos que ya conocemos):
${list || '(todavía no hay conceptos)'}

Tu tarea: decir QUÉ CONCEPTOS HACEN FALTA para construir ese experimento con fidelidad (las variables, las relaciones y las fórmulas del modelo).
- Cuando el concepto exista en la lista, usa su NOMBRE EXACTO. Si hace falta algo que NO está en la lista, escríbelo de todos modos (así sabremos que falta en los materiales): NO lo des por sabido.
- "esencial": true si sin eso no se puede armar el modelo; false si solo enriquece.
- "formula": true si para simularlo hace falta la ECUACIÓN de ese concepto.
- Entre 2 y ${DESIGN_LIMITS.requirements} requisitos.
- Si lo pedido NO es un experimento numérico que se pueda simular, responde {"requisitos": null, "motivo": "explicación breve"}.

Responde SOLO con un JSON válido:
{"requisitos":[{"termino":"","esencial":true,"formula":false}]}`;
}

export type RequirementsParse = { ok: true; requirements: Requirement[] } | { ok: false; reason: 'noFit' | 'unparseable'; message: string };

export function parseRequirements(text: string): RequirementsParse {
  const parsed = extractJsonObject(text);
  if (!isObj(parsed)) return { ok: false, reason: 'unparseable', message: 'La IA no devolvió una respuesta que se pueda leer.' };
  if (parsed.requisitos === null) {
    const motivo = typeof parsed.motivo === 'string' ? sanitizeText(parsed.motivo, 300) : '';
    return { ok: false, reason: 'noFit', message: motivo || 'Lo pedido no es un experimento numérico que se pueda simular.' };
  }
  if (!Array.isArray(parsed.requisitos)) return { ok: false, reason: 'unparseable', message: 'La IA no devolvió una lista de requisitos.' };
  const seen: Record<string, true> = {};
  const requirements: Requirement[] = [];
  for (const r of parsed.requisitos) {
    if (!isObj(r)) continue;
    const term = sanitizeText(r.termino, 80);
    const key = term.toLowerCase();
    if (term.length < 2 || seen[key]) continue;
    seen[key] = true;
    requirements.push({ term, essential: r.esencial !== false, needsFormula: r.formula === true });
    if (requirements.length === DESIGN_LIMITS.requirements) break;
  }
  if (requirements.length === 0) return { ok: false, reason: 'unparseable', message: 'La IA no indicó ningún requisito.' };
  return { ok: true, requirements };
}

// ───────────────────────────── paso 2: diseño ─────────────────────────────

// Los conceptos de la memoria que cubren los requisitos y sus prerrequisitos (lo que la IA debe usar), completando con los mas importantes si son pocos.
export function relevantConcepts(graph: Graph, coverage: Coverage): Concept[] {
  const byKey: Record<string, Concept> = {};
  graph.concepts.forEach((c) => {
    byKey[c.key] = c;
  });
  const picked: Concept[] = [];
  const seen: Record<string, true> = {};
  const add = (key: string) => {
    const c = byKey[key];
    if (c && !seen[key] && picked.length < DESIGN_LIMITS.relevant) {
      seen[key] = true;
      picked.push(c);
    }
  };
  coverage.items.forEach((i) => i.key && add(i.key));
  coverage.items.forEach((i) => i.key && prerequisitesOf(graph, i.key).forEach(add));
  if (picked.length < 6) memoryCatalog(graph, 10).forEach((c) => add(c.key));
  return picked;
}

// Un ejemplo compacto del formato (el que ya funciona), para que la IA copie la FORMA y no el tema.
function exampleJson(id: string): string {
  const e = MODEL_EXAMPLES.find((x) => x.id === id);
  return e ? JSON.stringify(e.raw) : '';
}

export function buildDesignPrompt(idea: string, relevant: Concept[], coverage: Coverage, errors: string[] = []): string {
  const concepts = relevant
    .map((c) => `- ${c.name} [${KIND_LABEL[c.kind]}]${c.definition ? `: ${c.definition}` : ''}${c.formula ? ` | Fórmula del material: ${c.formula}` : ''}${c.unit ? ` | Unidad: ${c.unit}` : ''}`)
    .join('\n');
  const gaps = coverage.weak.length ? `\nOJO, lo siguiente está flojo en los materiales (no inventes lo que falte, sé prudente): ${coverage.weak.join('; ')}.` : '';
  const fixes = errors.length
    ? `\nTU RESPUESTA ANTERIOR TUVO ESTOS PROBLEMAS (corrígelos; el modelo se prueba con números en todos sus rangos):\n${errors.map((e) => `- ${e}`).join('\n')}\n`
    : '';
  return `Eres un profesor experto que diseña un experimento de laboratorio NUMÉRICO en un ambiente controlado: el estudiante mueve UNA variable, mide resultados, grafica y concluye.

LO QUE PIDE EL PROFESOR: ${sanitizeText(idea, DESIGN_LIMITS.idea)}

LO QUE LOS MATERIALES DE LA CLASE EXPLICAN (apóyate SOLO en esto; si traen la fórmula, úsala tal cual, adaptando los símbolos):
${concepts}${gaps}
${fixes}
DESCRIBE EL MODELO como DATOS (no escribas código). Las fórmulas son texto:
- Operadores: + - * / ^ % y comparaciones; escribe SIEMPRE el signo * (2*x, no 2x); decimales con punto (0.5). Funciones permitidas: ${Expr.FUNCTIONS.join(', ')}. Constantes: pi, e.
- "variables": lo que el estudiante mueve (máx. ${MODEL_LIMITS.variables}): {"id","label","unit","min","max","step","default","decimals"}. ids: letras y números, empiezan por letra, sin tildes.
- "constants": valores del entorno que el profesor puede cambiar (máx. ${MODEL_LIMITS.constants}): {"id","label","unit","value","min","max","decimals"}.
- "derived": pasos intermedios en orden: {"id","expr"} (una fórmula solo puede usar lo declarado ANTES).
- "outputs": lo que se mide (máx. ${MODEL_LIMITS.outputs}): {"id","label","unit","decimals","expr"}.
- "independent": el id de la variable que se mueve. "chart": {"x","y"} con la gráfica inicial.
- "scene": {"xLabel","yLabel","curves":[...],"points":[...]}. Curva "sweep": {"kind":"sweep","label","output"} (una salida contra la variable independiente). Curva "param": {"kind":"param","label","dashed","x","y","from","to"} donde x e y son fórmulas de "param" y from/to son fórmulas sin "param" (p. ej. la recta presupuestal). Puntos: {"label","x","y"}.
- "basis": los NOMBRES EXACTOS de los conceptos de arriba en los que se apoya el modelo.
- "area": una de fisica, quimica, biologia, economia, matematicas, estadistica. "concept": una frase.
REGLAS IMPORTANTES
- El modelo se prueba con números en TODA la combinación de rangos: ninguna salida puede dar infinito o NaN. Protege divisiones y raíces con max(...) o if(...), y elige rangos razonables (por ejemplo, que el presupuesto no se acabe a la mitad sin que la fórmula lo contemple).
- COHERENCIA: cada variable, constante y paso debe influir en alguna salida. Si la materia tiene una RESTRICCIÓN (un presupuesto, una conservación, un balance), el modelo debe IMPONERLA con una fórmula: calcula una cantidad a partir de ella (como cantY en el primer ejemplo) en vez de dejar todas las cantidades libres e independientes. La salida de la gráfica debe cambiar cuando se mueve la variable independiente.
- Una sola variable independiente; las demás quedan fijas en modo controlado. Rangos y valores con sentido en el contexto de la materia.
- Los rangos NO pueden incluir valores donde una fórmula se indefine: si divides por una variable (o por algo que puede valer 0), su mínimo debe ser mayor que 0 (por ejemplo 0.5, como en los ejemplos); si usas ln o sqrt, protege el argumento con max(...). Prueba mentalmente los extremos de cada rango.
- "questions": de 3 a 5 preguntas que se respondan CON LOS DATOS que el estudiante mida, en español claro.
- Texto plano: sin HTML, sin Markdown ni LaTeX.
- Si lo pedido no se puede modelar con lo que explican los materiales, responde {"model": null, "motivo": "explicación breve"}.

EJEMPLOS DEL FORMATO (otro tema; copia la FORMA, no el contenido):
${exampleJson('consumidor')}
${exampleJson('poblacion')}

Responde SOLO con un JSON válido con esta forma:
{"title":"","objective":"","context":"","hypothesisPrompt":"","independent":"","mode":"controlado","minTrials":5,"questions":["",""],"model":{ "area":"","concept":"","variables":[],"constants":[],"derived":[],"outputs":[],"independent":"","chart":{"x":"","y":""},"scene":{},"basis":[] }}`;
}

// Resuelve las citas del modelo contra la memoria: solo cuentan los conceptos que existen; las cita se reemplazan por los nombres canonicos de la memoria.
export function resolveEvidence(graph: Graph, coverage: Coverage, cited: string[]): Evidence[] {
  const index = buildIndex(graph.concepts);
  const byKey: Record<string, Concept> = {};
  graph.concepts.forEach((c) => {
    byKey[c.key] = c;
  });
  const keys: string[] = [];
  const push = (k: string) => {
    if (byKey[k] && keys.indexOf(k) === -1) keys.push(k);
  };
  cited.forEach((name) => {
    const hit = searchConcepts(index, name, 1)[0];
    if (hit && hit.score >= DESIGN_LIMITS.cite) push(hit.key);
  });
  coverage.items.forEach((i) => i.covered && i.key && push(i.key));
  return keys
    .map((k) => byKey[k])
    .sort((a, b) => b.importance - a.importance || (a.key < b.key ? -1 : 1))
    .slice(0, DESIGN_LIMITS.evidence)
    .map((c) => ({ key: c.key, name: c.name, kind: c.kind, definition: c.definition, formula: c.formula, sources: c.sources }));
}

export type DesignParse = { ok: true; spec: LabSpec; warnings: string[] } | { ok: false; reason: 'unparseable' | 'noFit' | 'invalid'; message: string; errors: string[] };

export function parseDesign(text: string): DesignParse {
  const parsed = extractJsonObject(text);
  if (!isObj(parsed)) return { ok: false, reason: 'unparseable', message: 'La IA no devolvió una respuesta que se pueda leer.', errors: ['La respuesta no era un JSON válido. Responde SOLO con el JSON.'] };
  if (parsed.model === null) {
    const motivo = typeof parsed.motivo === 'string' ? sanitizeText(parsed.motivo, 300) : '';
    return { ok: false, reason: 'noFit', message: motivo || 'Con lo que explican los materiales no se puede modelar este experimento.', errors: [] };
  }
  // Si el modelo falla solo en el borde de un rango (por ejemplo dividir por 0), se acorta ese extremo y se avisa; lo demas se le devuelve a la IA.
  const fixed = repairModel(parsed.model);
  const v = validateLabSpec({ ...parsed, template: 'modelo', model: fixed.model });
  if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join(' '), errors: v.errors };
  return { ok: true, spec: v.spec, warnings: [...fixed.notes, ...v.warnings] };
}

// ───────────────────────────── el flujo completo ─────────────────────────────

export async function designLab(input: { idea: string; graph: Graph; allowPartial?: boolean }, call: ModelCaller): Promise<DesignResult> {
  const idea = sanitizeText(input.idea, DESIGN_LIMITS.idea);
  if (idea.length < 10) return { ok: false, reason: 'invalid', message: 'Cuéntame qué quieres que investiguen (al menos una frase).' };
  if (input.graph.concepts.length === 0) return { ok: false, reason: 'insufficient', message: 'La memoria de la clase está vacía. Constrúyela primero para que la IA conozca tus materiales.' };

  // 1. Requisitos y prueba de suficiencia.
  const reqText = await call(buildRequirementsPrompt(idea, input.graph));
  if (!reqText) return { ok: false, reason: 'noResponse', message: 'La IA no respondió. Inténtalo de nuevo en un momento.' };
  const req = parseRequirements(reqText);
  if (!req.ok) return { ok: false, reason: req.reason, message: req.message };
  const coverage = assessCoverage(req.requirements, input.graph);
  if (coverage.verdict === 'insufficient') return { ok: false, reason: 'insufficient', message: explainCoverage(coverage), coverage };
  if (coverage.verdict === 'partial' && !input.allowPartial) return { ok: false, reason: 'partial', message: explainCoverage(coverage), coverage };

  // 2. Diseño, con reintentos guiados por los errores de la validacion.
  const relevant = relevantConcepts(input.graph, coverage);
  let errors: string[] = [];
  let answered = false;
  let last: DesignResult = { ok: false, reason: 'noResponse', message: 'La IA no respondió. Inténtalo de nuevo en un momento.' };
  for (let i = 0; i < DESIGN_LIMITS.attempts; i++) {
    const text = await call(buildDesignPrompt(idea, relevant, coverage, errors));
    if (!text) continue;
    answered = true;
    const d = parseDesign(text);
    if (!d.ok) {
      // "No se puede modelar" es una respuesta legitima: no se reintenta.
      if (d.reason === 'noFit') return { ok: false, reason: 'noFit', message: d.message, coverage };
      errors = d.errors;
      last = { ok: false, reason: d.reason, message: d.message, coverage };
      continue;
    }
    const model = d.spec.model;
    const evidence = resolveEvidence(input.graph, coverage, model?.basis ?? []);
    const warnings = d.warnings.slice();
    if (model) model.basis = evidence.map((e) => e.name).slice(0, MODEL_LIMITS.basis);
    if (evidence.length === 0) warnings.push('No se pudo identificar en qué conceptos de tus materiales se apoya este modelo: revísalo con cuidado.');
    if (coverage.verdict === 'partial') warnings.push(`Se creó con materiales que cubren solo una parte: ${coverage.missing.join('; ')}.`);
    return { ok: true, spec: d.spec, warnings, evidence, coverage };
  }
  return answered ? last : { ok: false, reason: 'noResponse', message: 'La IA no respondió. Inténtalo de nuevo en un momento.' };
}

