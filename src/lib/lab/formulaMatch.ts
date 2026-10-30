// ¿Las fórmulas del modelo que escribio la IA son las que dicen los apuntes? La IA lee las ecuaciones de los materiales (memoria de la clase) y escribe un modelo; aqui se COMPARA,
// con numeros, lo que el modelo calcula contra las ecuaciones LITERALES de los conceptos en los que dice apoyarse. No se comparan textos: se evalua cada ecuacion de los apuntes sobre
// los estados reales del modelo (una rejilla de valores dentro de los rangos de sus variables y constantes) con el evaluador seguro propio (public/labs/expr.js, sin eval).
//
// Una ecuacion "L = R" de los apuntes se cumple en el modelo si L y R dan lo mismo en TODOS los estados. Eso cubre tanto la forma explicita (F = m·a) como la implicita
// (P·V = n·R·T) y no necesita despejar nada. Cada formula del modelo (paso intermedio o salida) queda etiquetada:
//   - exact_match : una ecuacion de los apuntes se cumple en todos los puntos probados;
//   - scaled_match: se cumple salvo un factor constante distinto de 1 (cambio de unidades: cm/m, atm/kPa, x100...);
//   - divergent   : la ecuacion habla de lo mismo (los simbolos se alinean por su NOMBRE) pero NO se cumple (o solo en parte de la rejilla: p. ej. el modelo pone un tope);
//   - unverified  : no hay con que compararla (los apuntes no traen una ecuacion que la incluya, no se pudo leer o no se pudieron alinear los simbolos).
// El renombrado de simbolos (la nota dice "k", el modelo "ke") solo puede LLEGAR a exact/scaled, nunca a acusar "divergent": ante la duda, "sin verificar" y no una falsa alarma.
// Es una AYUDA para el profesor, no una prueba matematica: la rejilla es finita. Sin red, determinista.

import { equationsIn } from '@/lib/memory/equations';
import { dice, normalizeKey } from '@/lib/memory/text';
import type { Concept, Graph } from '@/lib/memory/types';
import { Expr } from './model';
import type { LabModel } from './types';

export type FormulaStatus = 'exact_match' | 'scaled_match' | 'divergent' | 'unverified';

export interface FormulaCheck {
  // El id de la formula del modelo (paso intermedio o salida) y su nombre para mostrar.
  id: string;
  label: string;
  kind: 'derived' | 'output';
  status: FormulaStatus;
  // Solo en scaled_match: la constante por la que difiere (lado izquierdo = k · lado derecho).
  scale?: number;
  // Fraccion (0 a 1) de los puntos validos en que la ecuacion se cumple.
  agreement: number;
  // El concepto de los apuntes y su ecuacion literal con la que se comparo (si hubo).
  concept?: string;
  equation?: string;
  // true si hubo que renombrar simbolos para alinear la ecuacion con el modelo.
  renamed?: boolean;
  // Que simbolo de los apuntes corresponde a que nombre del modelo (solo si se alinearon).
  mapping?: Record<string, string>;
  // Explicacion en palabras para el profesor.
  reason: string;
}

export const FORMULA_MATCH_LIMITS = {
  // Estados probados (el primero es el valor inicial del modelo).
  states: 25,
  // Con menos puntos validos que esto no se concluye nada.
  minValid: 8,
  // Simbolos de la ecuacion sin equivalente por nombre que se intentan alinear probando permutaciones, y tamano maximo del conjunto de candidatos.
  maxRenamed: 3,
  maxPool: 12,
  // Alineaciones distintas que se conservan por ecuacion.
  maxAlignments: 6,
  // Ecuaciones por concepto y tamano maximo de una ecuacion.
  equationsPerConcept: 6,
  maxEquationChars: 200,
  // Tolerancia relativa al comparar.
  tol: 1e-6,
  // Una proporcion constante que difiere de 1 en menos que esto se considera redondeo de una constante, no otra escala.
  roundingTol: 0.01,
} as const;

// ───────────────────────── leer una ecuacion de los apuntes ─────────────────────────

const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', Δ: 'Delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ρ: 'rho',
  σ: 'sigma', Σ: 'Sigma', τ: 'tau', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega', Ω: 'Omega', π: 'pi',
};
const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

type Tok = { t: 'num' | 'id' | 'op'; v: string };

// "p_x · x + 2(y)" -> "p_x*x+2*(y)". null si trae algo que no sabemos leer (porcentajes, valores absolutos, "log" ambiguo, comparaciones...).
export function toExpression(src: string): string | null {
  let s = src.normalize('NFC');
  s = s.replace(/[−–—]/g, '-').replace(/[×·⋅∙•]/g, '*').replace(/÷/g, '/');
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => '^' + m.split('').map((c) => SUPERSCRIPT[c]).join(''));
  s = s.replace(/√\s*\(/g, 'sqrt(').replace(/√\s*([A-Za-z0-9_.]+)/g, 'sqrt($1)');
  s = s.replace(/[α-ωΑ-Ω]/g, (c) => GREEK[c] ?? c);
  // [S] (concentracion) -> S ; x_{ab} -> x_ab ; ^{2n} -> ^(2n)
  s = s.replace(/\[([A-Za-z0-9_]+)\]/g, '$1').replace(/_\{([A-Za-z0-9]+)\}/g, '_$1').replace(/\^\{([^{}]+)\}/g, '^($1)');
  if (/[%|≈∝≤≥<>{}!?]/.test(s)) return null;

  const toks: Tok[] = [];
  const re = /^\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z][A-Za-z0-9_]*)|(\*\*|[-+*/^(),]))/;
  let rest = s;
  while (rest.length > 0) {
    const m = re.exec(rest);
    if (!m) {
      if (/^\s*$/.test(rest)) break;
      return null;
    }
    rest = rest.slice(m[0].length);
    if (m[1] !== undefined) toks.push({ t: 'num', v: m[1] });
    else if (m[2] !== undefined) toks.push({ t: 'id', v: m[2] });
    else toks.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  if (toks.length === 0) return null;

  const isFn = (v: string) => Expr.FUNCTIONS.indexOf(v) !== -1;
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const cur = toks[i];
    const prev = toks[i - 1];
    if (cur.t === 'id' && cur.v === 'log') return null;
    if (prev) {
      const prevEnds = prev.t === 'num' || (prev.t === 'id' && !isFn(prev.v)) || (prev.t === 'op' && prev.v === ')');
      const startsOperand = cur.t === 'num' || cur.t === 'id' || (cur.t === 'op' && cur.v === '(');
      // Un identificador que no es funcion pegado a "(" es un producto (a(b+c)); una funcion pegada a "(" es la llamada.
      if (prevEnds && startsOperand) out.push('*');
    }
    out.push(cur.v);
  }
  return out.join('');
}

export interface ParsedEquation {
  text: string;
  left: string;
  right: string;
  // Nombres (tal como estan escritos en la ecuacion) que aparecen en ella.
  symbols: string[];
}

// "P·V = n·R·T" -> {left, right, symbols}. Solo ecuaciones con UN signo igual a cada lado de las que sabemos leer.
export function parseEquation(text: string): ParsedEquation | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > FORMULA_MATCH_LIMITS.maxEquationChars) return null;
  if (/[<>]=?|==|!=|≠/.test(text)) return null;
  const parts = text.split('=');
  if (parts.length !== 2 || parts[0].trim() === '' || parts[1].trim() === '') return null;
  // "U(x, y) = ..." : la notacion de funcion del lado izquierdo nombra la cantidad (U); los argumentos no son parte de la ecuacion.
  const lhs = parts[0].trim().replace(/^([A-Za-z][A-Za-z0-9_]*)\s*\([^()]*\)$/, (m, name: string) => (Expr.FUNCTIONS.indexOf(name) === -1 ? name : m));
  const left = toExpression(lhs);
  const right = toExpression(parts[1]);
  if (left === null || right === null) return null;
  const pl = Expr.parse(left);
  const pr = Expr.parse(right);
  if (!pl.ok || !pr.ok) return null;
  const symbols: string[] = [];
  pl.idents.concat(pr.idents).forEach((i) => symbols.indexOf(i) === -1 && symbols.push(i));
  if (symbols.length === 0) return null;
  return { text, left, right, symbols };
}

// ───────────────────────── estados de prueba del modelo ─────────────────────────

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Cada estado es el entorno completo del modelo (variables, constantes, pasos y salidas) para valores dentro de los rangos. Deterministico.
export function sampleStates(model: LabModel): Record<string, number>[] | null {
  const c = Expr.compileModel({ variables: model.variables, constants: model.constants, derived: model.derived, outputs: model.outputs });
  if (!c.ok) return null;
  const rand = rng(20261030);
  const states: Record<string, number>[] = [];
  for (let n = 0; n < FORMULA_MATCH_LIMITS.states; n++) {
    const values: Record<string, number> = {};
    const consts: Record<string, number> = {};
    model.variables.forEach((v) => (values[v.id] = n === 0 ? v.default : v.min + rand() * (v.max - v.min)));
    model.constants.forEach((k) => (consts[k.id] = n === 0 ? k.value : k.min + rand() * (k.max - k.min)));
    states.push(c.run(values, consts));
  }
  return states;
}

// ───────────────────────── comparar una ecuacion con el modelo ─────────────────────────

const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const near = (a: number, b: number) => Math.abs(a - b) <= FORMULA_MATCH_LIMITS.tol * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;

interface Evaluated {
  status: FormulaStatus;
  scale?: number;
  agreement: number;
  reason: string;
}

// Evalua L y R con el mapa simbolo->nombre del modelo en cada estado.
function evaluateEquation(left: (env: Record<string, number>) => number, right: (env: Record<string, number>) => number, mapping: Record<string, string>, states: Record<string, number>[]): Evaluated {
  const pairs: [number, number][] = [];
  let equal = 0;
  for (const st of states) {
    const env: Record<string, number> = Object.create(null);
    let ok = true;
    for (const sym of Object.keys(mapping)) {
      const v = st[mapping[sym]];
      if (typeof v !== 'number' || !isFinite(v)) {
        ok = false;
        break;
      }
      env[sym] = v;
    }
    if (!ok) continue;
    const l = left(env);
    const r = right(env);
    if (!isFinite(l) || !isFinite(r)) continue;
    pairs.push([l, r]);
    if (near(l, r)) equal++;
  }
  if (pairs.length < FORMULA_MATCH_LIMITS.minValid) {
    return { status: 'unverified', agreement: 0, reason: 'Con los valores probados la ecuación no se pudo calcular en suficientes puntos.' };
  }
  const agreement = equal / pairs.length;
  if (equal === pairs.length) return { status: 'exact_match', agreement: 1, reason: 'La ecuación de los apuntes se cumple en todos los puntos probados.' };

  // ¿L = k·R con k constante?
  let k: number | null = null;
  let proportional = true;
  for (const [l, r] of pairs) {
    if (Math.abs(r) <= 1e-12) {
      if (Math.abs(l) > 1e-9) {
        proportional = false;
        break;
      }
      continue;
    }
    const q = l / r;
    if (k === null) k = q;
    else if (!near(q, k)) {
      proportional = false;
      break;
    }
  }
  // Una proporcion muy cercana a 1 es el redondeo de una constante en los apuntes (0.0821 en vez de 0.08206), no otra escala.
  if (proportional && k !== null && isFinite(k) && Math.abs(k - 1) < FORMULA_MATCH_LIMITS.roundingTol) {
    return { status: 'exact_match', agreement: 1, reason: `La ecuación de los apuntes se cumple salvo redondeos (diferencia de ${Number((Math.abs(k - 1) * 100).toPrecision(2))} %).` };
  }
  if (proportional && k !== null && isFinite(k) && Math.abs(k) > 1e-12 && !near(k, 1)) {
    return { status: 'scaled_match', scale: Number(k.toPrecision(6)), agreement, reason: `Coincide con los apuntes salvo un factor constante de ${Number(k.toPrecision(4))} (¿otra unidad?).` };
  }
  const pct = Math.round(agreement * 100);
  return {
    status: 'divergent',
    agreement,
    reason: agreement > 0
      ? `Los apuntes dicen otra cosa: la ecuación se cumple solo en ${pct} % de los puntos probados (¿el modelo pone un tope o una condición que el material no menciona?).`
      : 'Los apuntes dicen otra cosa: la ecuación no se cumple en ningún punto probado.',
  };
}

function permutations<T>(pool: T[], size: number, visit: (picked: T[]) => boolean): void {
  const used: boolean[] = pool.map(() => false);
  const cur: T[] = [];
  const go = (): boolean => {
    if (cur.length === size) return visit(cur.slice());
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(pool[i]);
      const stop = go();
      cur.pop();
      used[i] = false;
      if (stop) return true;
    }
    return false;
  };
  go();
}

interface EquationVerdict extends Evaluated {
  mapping?: Record<string, string>;
  renamed: boolean;
  // Los pasos/salidas del modelo que intervienen en la ecuacion.
  targets: string[];
}

// Compara UNA ecuacion de los apuntes con el modelo. Devuelve un veredicto por cada forma razonable de alinear sus simbolos con los nombres del modelo:
//  - si TODOS los simbolos tienen un homonimo (igual, o igual sin mayusculas ni signos, p. ej. "p_x" ~ "px"), esa es la lectura y su veredicto puede ser cualquiera (incluso divergent);
//  - si alguno no lo tiene, o tiene mas de un candidato, se prueban las asignaciones posibles y SOLO se conservan las que confirman (exact/scaled): una ecuacion como P = I²·R es cierta
//    leyendo R como la carga o como la resistencia interna, y las dos lecturas verifican formulas distintas. Nunca se acusa a partir de un renombrado.
export function checkEquation(eq: ParsedEquation, model: LabModel, states: Record<string, number>[]): EquationVerdict[] {
  const modelIds = model.variables.map((v) => v.id).concat(model.constants.map((c) => c.id), model.derived.map((d) => d.id), model.outputs.map((o) => o.id));
  const formulaIds: Record<string, true> = Object.create(null);
  model.derived.forEach((d) => (formulaIds[d.id] = true));
  model.outputs.forEach((o) => (formulaIds[o.id] = true));

  const left = Expr.compile(eq.left, eq.symbols);
  const right = Expr.compile(eq.right, eq.symbols);
  if (!left.ok || !right.ok) return [];
  const targetsOf = (m: Record<string, string>) => Object.keys(m).map((k) => m[k]).filter((id) => formulaIds[id]);

  // 1. Homonimos exactos quedan fijos; el resto es "libre".
  const fixed: Record<string, string> = Object.create(null);
  const taken: Record<string, true> = Object.create(null);
  const free: string[] = [];
  for (const sym of eq.symbols) {
    if (modelIds.indexOf(sym) !== -1 && !taken[sym]) {
      fixed[sym] = sym;
      taken[sym] = true;
    } else free.push(sym);
  }

  // 2. Lectura por nombre: cada simbolo libre con UN solo homonimo aproximado que no este ya tomado.
  const byName: Record<string, string> = { ...fixed };
  let complete = true;
  for (const sym of free) {
    const cands = modelIds.filter((id) => canon(id) === canon(sym) && !taken[id] && id !== byName[sym]);
    if (cands.length === 1 && !taken[cands[0]]) {
      byName[sym] = cands[0];
      taken[cands[0]] = true;
    } else complete = false;
  }
  if (complete) {
    const targets = targetsOf(byName);
    if (targets.length === 0) return []; // la ecuacion solo relaciona variables y constantes: no verifica ninguna formula
    const ev = evaluateEquation(left.fn, right.fn, byName, states);
    const renamed = free.length > 0 && free.some((f) => f !== byName[f] && canon(f) !== canon(byName[f]));
    return [{ ...ev, mapping: byName, renamed, targets }];
  }

  // 3. Sin lectura por nombre: se prueban las asignaciones de los simbolos libres a los nombres que quedan. Solo confirman.
  const fixedTaken: Record<string, true> = Object.create(null);
  Object.keys(fixed).forEach((k) => (fixedTaken[fixed[k]] = true));
  const pool = modelIds.filter((id) => !fixedTaken[id]);
  if (free.length > FORMULA_MATCH_LIMITS.maxRenamed || pool.length > FORMULA_MATCH_LIMITS.maxPool || pool.length < free.length) {
    return [{ status: 'unverified', agreement: 0, reason: `No se pudieron alinear los símbolos de la ecuación (${free.join(', ')}) con los nombres del modelo.`, renamed: false, targets: [] }];
  }
  const found: EquationVerdict[] = [];
  const seen: Record<string, true> = Object.create(null);
  permutations(pool, free.length, (picked) => {
    const m: Record<string, string> = { ...fixed };
    free.forEach((sym, i) => (m[sym] = picked[i]));
    const targets = targetsOf(m);
    if (targets.length === 0) return false;
    const ev = evaluateEquation(left.fn, right.fn, m, states);
    if (ev.status !== 'exact_match' && ev.status !== 'scaled_match') return false;
    const sig = targets.slice().sort().join(',') + '|' + ev.status;
    if (!seen[sig]) {
      seen[sig] = true;
      found.push({ ...ev, mapping: m, renamed: true, targets });
    }
    return found.length >= FORMULA_MATCH_LIMITS.maxAlignments;
  });
  if (found.length > 0) return found;
  return [{ status: 'unverified', agreement: 0, reason: `La ecuación de los apuntes no se pudo alinear con el modelo (símbolos sin equivalente: ${free.join(', ')}).`, renamed: false, targets: [] }];
}

// ───────────────────────── de los conceptos de la memoria al modelo ─────────────────────────

function conceptFor(graph: Graph, name: string): Concept | null {
  const k = normalizeKey(name);
  let best: { c: Concept; d: number } | null = null;
  for (const c of graph.concepts) {
    if (c.key === k) return c;
    const d = dice(c.key, k);
    if (d >= 0.85 && (!best || d > best.d)) best = { c, d };
  }
  return best ? best.c : null;
}

// Las ecuaciones LITERALES de un concepto: su campo de formula y las que aparecen escritas en su definicion.
export function conceptEquations(c: Concept): string[] {
  const found: string[] = [];
  const add = (e: string) => e && found.indexOf(e) === -1 && found.length < FORMULA_MATCH_LIMITS.equationsPerConcept && found.push(e);
  if (c.formula && c.formula.indexOf('=') !== -1) add(c.formula.trim());
  if (c.definition) equationsIn(c.definition).forEach(add);
  return found;
}

const RANK: Record<FormulaStatus, number> = { exact_match: 3, scaled_match: 2, divergent: 1, unverified: 0 };

// Etiqueta cada formula (pasos y salidas) del modelo contra las ecuaciones de los conceptos en los que dice apoyarse (model.basis).
export function checkModelFormulas(model: LabModel, graph: Graph): FormulaCheck[] {
  const formulas: { id: string; label: string; kind: 'derived' | 'output' }[] = [];
  model.derived.forEach((d) => formulas.push({ id: d.id, label: d.id, kind: 'derived' }));
  model.outputs.forEach((o) => formulas.push({ id: o.id, label: o.label || o.id, kind: 'output' }));
  const result: Record<string, FormulaCheck> = Object.create(null);
  const none = (reason: string) => formulas.map((f): FormulaCheck => ({ id: f.id, label: f.label, kind: f.kind, status: 'unverified', agreement: 0, reason }));

  const concepts = (model.basis ?? []).map((n) => conceptFor(graph, n)).filter((c): c is Concept => !!c);
  if (concepts.length === 0) return none('El modelo no se apoya en ningún concepto de la memoria de la clase: no hay con qué compararlo.');
  const equations: { concept: Concept; eq: ParsedEquation }[] = [];
  concepts.forEach((c) =>
    conceptEquations(c).forEach((text) => {
      const eq = parseEquation(text);
      if (eq) equations.push({ concept: c, eq });
    })
  );
  if (equations.length === 0) return none('Los conceptos en los que se apoya no traen una ecuación que se pueda leer en los materiales.');
  const states = sampleStates(model);
  if (!states) return none('El modelo no se pudo calcular para compararlo.');

  // Por cada formula, lo que dijo cada ecuacion que la incluye. Una divergencia clara (de una ecuacion que solo habla de ESA formula) manda sobre un acierto en otra ecuacion;
  // si no, vale el mejor resultado.
  const seen: Record<string, { v: EquationVerdict; concept: string; eq: string; single: boolean }[]> = Object.create(null);
  for (const { concept, eq } of equations) {
    for (const v of checkEquation(eq, model, states)) {
      for (const id of v.targets) (seen[id] = seen[id] ?? []).push({ v, concept: concept.name, eq: eq.text, single: v.targets.length === 1 });
    }
  }
  for (const f of formulas) {
    const list = seen[f.id];
    if (!list || list.length === 0) continue;
    const firm = list.find((x) => x.v.status === 'divergent' && x.single);
    const pick = firm ?? list.reduce((best, x) => (RANK[x.v.status] > RANK[best.v.status] ? x : best), list[0]);
    result[f.id] = { id: f.id, label: f.label, kind: f.kind, status: pick.v.status, scale: pick.v.scale, agreement: pick.v.agreement, concept: pick.concept, equation: pick.eq, renamed: pick.v.renamed || undefined, mapping: pick.v.mapping, reason: pick.v.reason };
  }
  return formulas.map((f) => result[f.id] ?? { id: f.id, label: f.label, kind: f.kind, status: 'unverified' as const, agreement: 0, reason: 'Ninguna ecuación de los apuntes habla de esta fórmula.' });
}

export interface FormulaSummary {
  exact: number;
  scaled: number;
  divergent: number;
  unverified: number;
}

export function summarizeChecks(checks: FormulaCheck[]): FormulaSummary {
  const s: FormulaSummary = { exact: 0, scaled: 0, divergent: 0, unverified: 0 };
  checks.forEach((c) => {
    if (c.status === 'exact_match') s.exact++;
    else if (c.status === 'scaled_match') s.scaled++;
    else if (c.status === 'divergent') s.divergent++;
    else s.unverified++;
  });
  return s;
}
