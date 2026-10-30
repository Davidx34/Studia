// "¿Mis materiales alcanzan para los objetivos de aprendizaje que puse?" Cruza los objetivos de la clase (classroom_learning_objectives) con la memoria de la clase y dice, objetivo
// por objetivo, si esta CUBIERTO por lo que el profesor ya subio (sufficient), a medias (partial) o HUERFANO, sin respaldo en los materiales (insufficient). Tambien lista los temas
// centrales de los materiales que NINGUN objetivo menciona. Es una funcion pura: sin red ni IA; reutiliza la prueba de suficiencia (sufficiency.ts) para medir cada termino.

import { assessCoverage, type CoverageItem, type Requirement, type Verdict } from './sufficiency';
import { fold } from './text';
import type { Graph } from './types';

export interface ObjectiveInput {
  id: string;
  title: string;
  description?: string | null;
}

export interface ObjectiveCoverage {
  id: string;
  title: string;
  verdict: Verdict;
  // Fraccion (0 a 1) de los terminos del objetivo cubiertos por la memoria, ponderando los esenciales el doble.
  ratio: number;
  // Cada termino del objetivo y con que concepto de la memoria se cubrio.
  items: CoverageItem[];
  // En palabras, para el profesor.
  missing: string[];
  weak: string[];
}

export interface UncoveredTopic {
  key: string;
  name: string;
  importance: number;
}

export interface ObjectivesReport {
  objectives: ObjectiveCoverage[];
  counts: { sufficient: number; partial: number; insufficient: number };
  // Conceptos centrales de los materiales que ningun objetivo toca (candidatos a un objetivo nuevo).
  uncoveredTopics: UncoveredTopic[];
}

export const OBJECTIVE_LIMITS = {
  // Terminos por objetivo y largo maximo de cada uno.
  terms: 8,
  termWords: 6,
  termChars: 80,
  // Importancia minima para considerar un tema "central", y cuantos se listan.
  centralImportance: 4,
  uncovered: 8,
} as const;

// Verbos con los que empieza casi todo objetivo ("Comprender la oferta..."): no son parte de lo que hay que saber.
const LEAD_VERBS = [
  'comprender', 'comprende', 'entender', 'entiende', 'analizar', 'analiza', 'identificar', 'identifica', 'explicar', 'explica', 'calcular', 'calcula', 'aplicar', 'aplica',
  'describir', 'describe', 'reconocer', 'reconoce', 'distinguir', 'distingue', 'diferenciar', 'diferencia', 'comparar', 'compara', 'resolver', 'resuelve', 'interpretar', 'interpreta',
  'evaluar', 'evalua', 'conocer', 'conoce', 'definir', 'define', 'utilizar', 'utiliza', 'usar', 'usa', 'elaborar', 'elabora', 'construir', 'construye', 'representar', 'representa',
  'estudiar', 'estudia', 'dominar', 'domina', 'manejar', 'maneja', 'relacionar', 'relaciona', 'deducir', 'deduce', 'demostrar', 'demuestra', 'graficar', 'grafica', 'determinar',
  'determina', 'predecir', 'predice', 'justificar', 'justifica', 'clasificar', 'clasifica', 'ubicar', 'ubica', 'localizar', 'localiza', 'reconstruir', 'reconstruye', 'valorar',
  'valora', 'argumentar', 'argumenta', 'sintetizar', 'sintetiza', 'formular', 'formula', 'plantear', 'plantea', 'medir', 'mide', 'modelar', 'modela', 'simular', 'simula',
];
// "El estudiante sera capaz de / podra / debera ..."
const CAPABLE = /^(?:el|la)\s+(?:estudiante|alumno|alumna)\s+(?:sera\s+capaz\s+de|podra|debera|lograra|aprendera\s+a)\s+/;
const LEAD_WORDS = /^(?:aprender\s+a|ser\s+capaz\s+de|lograr|saber)\s+/;
const ARTICLES = /^(?:el|la|los|las|un|una|unos|unas|lo|de|del|al|en|sobre|acerca\s+de|como|que|con|para|por)\s+/;

// Quita del inicio del texto lo que no es parte de lo que hay que saber. Compara sobre una copia SIN tildes ni mayusculas pero conserva el texto original (el profesor lo lee).
function trimLead(words: string[]): string[] {
  let cur = words;
  const drop = (re: RegExp): boolean => {
    const m = re.exec(fold(cur.join(' ')));
    if (!m || m[0].trim() === '') return false;
    cur = cur.slice(m[0].trim().split(/\s+/).length);
    return true;
  };
  drop(CAPABLE);
  drop(LEAD_WORDS);
  if (cur.length > 0 && LEAD_VERBS.indexOf(fold(cur[0])) !== -1) cur = cur.slice(1);
  for (let i = 0; i < 4 && cur.length > 0; i++) if (!drop(ARTICLES)) break;
  return cur;
}

// De un objetivo a los terminos que hay que encontrar en la memoria: el titulo parte en "a, b y c" (esenciales) y, si la descripcion enumera cosas cortas, se suman como deseables.
export function objectiveTerms(title: string, description?: string | null): Requirement[] {
  const out: Requirement[] = [];
  const seen: Record<string, true> = Object.create(null);
  const add = (raw: string, essential: boolean) => {
    const cleaned = raw.replace(/[.:;!?"“”()]+/g, ' ').replace(/\s+/g, ' ').trim();
    const ws = trimLead(cleaned.length > 0 ? cleaned.split(' ') : []);
    const t = ws.join(' ');
    const key = fold(t);
    if (ws.length === 0 || ws.length > OBJECTIVE_LIMITS.termWords || t.length < 3 || t.length > OBJECTIVE_LIMITS.termChars || seen[key] || out.length >= OBJECTIVE_LIMITS.terms) return;
    seen[key] = true;
    out.push({ term: t, essential });
  };
  const split = (text: string) => String(text ?? '').split(/,|;|\s+y\s+|\s+e\s+|\s+(?:ademas|además)\s+de\s+/i);
  split(title).forEach((p) => add(p, true));
  // Si el titulo no dejo nada util (solo un verbo), no hay objetivo que medir.
  if (description) {
    const first = String(description).split(/[.\n]/)[0] ?? '';
    split(first).forEach((p) => add(p, false));
  }
  return out;
}

// Veredicto por objetivo. Lo esencial del objetivo = lo de su titulo. "Cubierto" = todo lo esencial esta (con definicion) y el resto del peso alcanza; "a medias" = algo del objetivo
// esta o falta poco; "huerfano" = nada esencial aparece en los materiales.
function verdictOf(items: CoverageItem[], ratio: number): Verdict {
  const essentials = items.filter((i) => i.essential);
  if (essentials.length === 0) return 'insufficient';
  const covered = essentials.filter((i) => i.covered).length;
  if (covered === essentials.length && ratio >= 0.75) return 'sufficient';
  if (covered > 0 || ratio >= 0.4 || items.some((i) => i.key !== null && !i.covered)) return 'partial';
  return 'insufficient';
}

export function assessObjectives(objectives: ObjectiveInput[], graph: Graph): ObjectivesReport {
  const touched: Record<string, true> = Object.create(null);
  const results: ObjectiveCoverage[] = objectives.map((o) => {
    const requirements = objectiveTerms(o.title, o.description);
    if (requirements.length === 0 || graph.concepts.length === 0) {
      const why = graph.concepts.length === 0 ? 'La memoria de la clase está vacía.' : 'No se pudo entender qué conceptos nombra el objetivo.';
      return { id: o.id, title: o.title, verdict: 'insufficient' as const, ratio: 0, items: [], missing: [why], weak: [] };
    }
    const cov = assessCoverage(requirements, graph);
    cov.items.forEach((i) => i.key && (touched[i.key] = true));
    return { id: o.id, title: o.title, verdict: verdictOf(cov.items, cov.ratio), ratio: cov.ratio, items: cov.items, missing: cov.missing, weak: cov.weak };
  });
  const counts = { sufficient: 0, partial: 0, insufficient: 0 };
  results.forEach((r) => counts[r.verdict]++);

  const uncoveredTopics = objectives.length === 0
    ? []
    : graph.concepts
        .filter((c) => c.importance >= OBJECTIVE_LIMITS.centralImportance && !touched[c.key])
        .sort((a, b) => b.importance - a.importance || b.mentions - a.mentions || (a.key < b.key ? -1 : 1))
        .slice(0, OBJECTIVE_LIMITS.uncovered)
        .map((c) => ({ key: c.key, name: c.name, importance: c.importance }));
  return { objectives: results, counts, uncoveredTopics };
}
