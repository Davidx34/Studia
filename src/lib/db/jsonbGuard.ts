// Guardia de los documentos que se escriben en columnas jsonb (la parte "documental" de la base: el grafo de la clase, la ficha de un laboratorio, los intentos de laboratorio...).
//
// La base ya tiene su ultima defensa (un CHECK de tipo y de tamaño por columna), pero un CHECK que falla devuelve un error generico y deja a medias lo que se estaba haciendo. Esta guardia
// corre ANTES, en codigo puro y sin red, y hace tres cosas:
//  1. LIMPIA lo que Postgres rechaza o lo que es peligroso: el caracter NUL (\u0000, que jsonb no admite), sustitutos Unicode sueltos (jsonb los rechaza), numeros no finitos (no son JSON)
//     y las claves `__proto__`, `constructor` y `prototype` (envenenamiento de prototipos si alguien mezcla el documento con otro objeto).
//  2. ACOTA: profundidad, cantidad de nodos y tamaño en bytes UTF-8, con los mismos topes que los CHECK de las migraciones.
//  3. EXIGE la raiz que la columna espera (objeto o arreglo) y rechaza ciclos y valores que no son JSON (funciones, simbolos, bigint).
//
// Limite que conviene tener presente: el CHECK de la base mide `pg_column_size` (el tamaño binario de jsonb, comprimido si es grande), no los bytes del texto JSON. Aqui se mide el texto
// JSON: es una buena estimacion, no una garantia. Un documento lleno de numeros pequeños puede ocupar mas en jsonb que en texto; por eso el CHECK de la base se mantiene como respaldo.
//
// INDICES: ninguna consulta de la app filtra DENTRO de estos documentos (se leen enteros por clave primaria o por clase), asi que no hace falta ningun indice GIN. Si algun dia se filtra por
// una clave interna (por ejemplo `spec->>'template'`), conviene un indice de expresion sobre esa clave y no un GIN general; un GIN sobre documentos de hasta ~800 KB encarece cada escritura.

export const JSONB_BUDGETS = {
  // Migracion 078 (labs.spec)
  labSpec: { limit: 20_000, root: 'object' },
  // Migracion 079 (class_memory)
  classMemoryGraph: { limit: 800_000, root: 'object' },
  classMemoryStats: { limit: 4_000, root: 'object' },
  // Migracion 079 (class_memory_material)
  materialExtraction: { limit: 400_000, root: 'object' },
  materialStats: { limit: 4_000, root: 'object' },
  // Migracion 082 (lab_attempts)
  labTrials: { limit: 65_536, root: 'array' },
  labAnswers: { limit: 16_384, root: 'array' },
} as const;

export type JsonbBudgetName = keyof typeof JSONB_BUDGETS;
export type JsonbBudget = { limit: number; root: 'object' | 'array' };

export const DANGEROUS_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
export const JSONB_MAX_DEPTH = 12;
export const JSONB_MAX_NODES = 500_000;

export type JsonbFailure = 'notObject' | 'notArray' | 'depth' | 'nodes' | 'cycle' | 'unsupported' | 'size';

export interface JsonbReport {
  removedKeys: number; // claves peligrosas quitadas
  strippedNul: number; // caracteres NUL quitados
  fixedSurrogates: number; // sustitutos Unicode sueltos reemplazados
  nonFinite: number; // NaN / Infinity pasados a null
}

export type JsonbResult<T = unknown> =
  | { ok: true; value: T; bytes: number; report: JsonbReport }
  | { ok: false; reason: JsonbFailure; message: string; bytes?: number };

export interface JsonbOptions {
  maxDepth?: number;
  maxNodes?: number;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

class Reject extends Error {
  constructor(
    readonly reason: JsonbFailure,
    message: string
  ) {
    super(message);
  }
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function cleanString(s: string, report: JsonbReport): string {
  let out = s;
  if (out.indexOf('\u0000') !== -1) {
    out = out.replace(/\u0000/g, (m) => {
      report.strippedNul++;
      return '';
    });
  }
  return out.replace(LONE_SURROGATE, () => {
    report.fixedSurrogates++;
    return '�';
  });
}

// Copia limpia del valor. Lanza Reject ante lo que no se puede arreglar.
function clean(value: unknown, depth: number, ctx: { maxDepth: number; maxNodes: number; nodes: number; ancestors: Set<object>; report: JsonbReport }): unknown {
  if (++ctx.nodes > ctx.maxNodes) throw new Reject('nodes', 'El documento tiene demasiados elementos.');
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return cleanString(value, ctx.report);
    case 'boolean':
      return value;
    case 'number':
      if (Number.isFinite(value)) return value;
      ctx.report.nonFinite++;
      return null;
    case 'undefined':
      return null; // en un objeto la clave se omite antes de llegar aqui; en un arreglo JSON la guarda como null
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new Reject('unsupported', 'El documento contiene un valor que no es JSON.');
  }
  const obj = value as object;
  if (depth > ctx.maxDepth) throw new Reject('depth', 'El documento esta demasiado anidado.');
  if (ctx.ancestors.has(obj)) throw new Reject('cycle', 'El documento se referencia a si mismo.');
  const toJSON = (obj as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') return clean((toJSON as () => unknown).call(obj), depth, ctx); // p. ej. Date
  ctx.ancestors.add(obj);
  try {
    if (Array.isArray(obj)) return obj.map((v) => clean(v, depth + 1, ctx));
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      if (DANGEROUS_KEYS.indexOf(k) !== -1) {
        ctx.report.removedKeys++;
        continue;
      }
      const v = (obj as Record<string, unknown>)[k];
      if (v === undefined) continue;
      out[cleanString(k, ctx.report)] = clean(v, depth + 1, ctx);
    }
    return out;
  } finally {
    ctx.ancestors.delete(obj);
  }
}

// Limpia y comprueba un documento contra un presupuesto con nombre (o uno propio). Devuelve una COPIA limpia lista para escribir; nunca modifica el original ni lanza.
export function guardJsonb(value: unknown, budget: JsonbBudgetName | JsonbBudget, opts: JsonbOptions = {}): JsonbResult {
  const b: JsonbBudget = typeof budget === 'string' ? JSONB_BUDGETS[budget] : budget;
  const isArr = Array.isArray(value);
  const isObj = !!value && typeof value === 'object' && !isArr;
  if (b.root === 'object' && !isObj) return { ok: false, reason: 'notObject', message: 'El documento debe ser un objeto.' };
  if (b.root === 'array' && !isArr) return { ok: false, reason: 'notArray', message: 'El documento debe ser un arreglo.' };

  const report: JsonbReport = { removedKeys: 0, strippedNul: 0, fixedSurrogates: 0, nonFinite: 0 };
  let cleaned: unknown;
  try {
    cleaned = clean(value, 1, { maxDepth: opts.maxDepth ?? JSONB_MAX_DEPTH, maxNodes: opts.maxNodes ?? JSONB_MAX_NODES, nodes: 0, ancestors: new Set(), report });
  } catch (e) {
    if (e instanceof Reject) return { ok: false, reason: e.reason, message: e.message };
    return { ok: false, reason: 'unsupported', message: 'El documento no se pudo leer.' };
  }
  const bytes = utf8Length(JSON.stringify(cleaned));
  // La columna exige estrictamente MENOS que el limite.
  if (bytes >= b.limit) return { ok: false, reason: 'size', bytes, message: `El documento pesa ${bytes} bytes y el maximo es ${b.limit - 1}.` };
  return { ok: true, value: cleaned, bytes, report };
}
