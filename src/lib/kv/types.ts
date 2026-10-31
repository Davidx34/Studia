// Contrato de la capa CLAVE-VALOR con vencimiento (TTL). Es una capa de VELOCIDAD, no de verdad: guarda copias recalculables (vectores de consulta, el grafo de una clase en una version)
// y contadores efimeros. La fuente de verdad sigue siendo Postgres; si esta capa se vacia o no esta configurada, el sistema funciona igual (solo mas lento).
//
// Reglas del contrato:
//  - Toda clave sale de buildKvKey (keys.ts): nadie arma claves a mano ni puede colarse en el espacio de otro.
//  - Todo valor lleva TTL (1 s a 7 dias): no hay claves eternas que crezcan sin fin.
//  - Nada se lee a ciegas: get recibe un validador y lo que no pasa se BORRA y se trata como ausente.
//  - Ninguna operacion lanza: ante cualquier falla (red, formato, tamaño) la lectura da null y la escritura se omite.
//  - Prohibido guardar tokens de sesion, correos, contraseñas ni llaves de API.

declare const kvKeyBrand: unique symbol;
// Una clave ya validada por buildKvKey. El tipo impide pasar un string cualquiera a las operaciones.
export type KvKey = string & { readonly [kvKeyBrand]: true };

export type KvGuard<T> = (value: unknown) => value is T;

export interface KeyValueStore {
  // null si no existe, vencio, no se pudo leer o NO pasa el validador (en ese caso la clave se borra).
  get<T>(key: KvKey, guard: KvGuard<T>): Promise<T | null>;
  // Guarda `value` (JSON) por `ttlSeconds`. Se omite en silencio si el TTL es invalido o el valor no cabe.
  set<T>(key: KvKey, value: T, ttlSeconds: number): Promise<void>;
  del(key: KvKey): Promise<void>;
  // Contador de ventana FIJA: suma 1 y devuelve el total y los segundos que le quedan a la ventana.
  incrWithWindow(key: KvKey, windowSeconds: number): Promise<{ count: number; ttlSeconds: number }>;
}

export const KV_LIMITS = {
  minTtlSeconds: 1,
  maxTtlSeconds: 7 * 24 * 3600,
  // Un grafo de clase puede pesar hasta ~800 KB en la base (CHECK de class_memory): el tope por valor lo deja entrar.
  maxValueBytes: 1024 * 1024,
  memoryMaxKeys: 2000,
  memoryMaxTotalBytes: 32 * 1024 * 1024,
  maxKeyLength: 250,
  maxSegmentLength: 80,
  maxSegments: 6,
} as const;

export function isValidTtl(ttlSeconds: unknown): ttlSeconds is number {
  return typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds) && ttlSeconds >= KV_LIMITS.minTtlSeconds && ttlSeconds <= KV_LIMITS.maxTtlSeconds;
}

// Tamaño en bytes UTF-8 de un texto.
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

// Serializa un valor para guardarlo. null si no es JSON valido o excede el tope por valor.
export function encodeValue(value: unknown, maxBytes: number = KV_LIMITS.maxValueBytes): string | null {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof text !== 'string') return null; // undefined, funciones...
  return utf8Bytes(text) <= maxBytes ? text : null;
}
