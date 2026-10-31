// Constructor de claves. Una clave es `espacio:parte:parte...` y TODA parte debe ser un token simple: sin ':' (el separador), '*' ni espacios. Asi quien aporta una parte (un texto hasheado,
// un id, un nombre de modelo) jamas puede saltar a otro espacio de nombres (de `emb:` a `quota:`) ni armar un patron.

import { KV_LIMITS, type KvKey } from './types';

// Espacios de nombres cerrados. Agregar uno exige tocar esta lista (y la revision que eso trae).
export const KV_NAMESPACES = ['emb', 'mem', 'quota', 'health'] as const;
export type KvNamespace = (typeof KV_NAMESPACES)[number];

const SEGMENT_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const KEY_RE = /^(emb|mem|quota|health)(:[A-Za-z0-9_.-]{1,80}){1,6}$/;

export class KvKeyError extends Error {}

export function buildKvKey(namespace: KvNamespace, ...parts: string[]): KvKey {
  if ((KV_NAMESPACES as readonly string[]).indexOf(namespace) === -1) throw new KvKeyError('espacio de nombres desconocido');
  if (parts.length < 1 || parts.length > KV_LIMITS.maxSegments) throw new KvKeyError('cantidad de partes invalida');
  for (const p of parts) {
    if (typeof p !== 'string' || p.length > KV_LIMITS.maxSegmentLength || !SEGMENT_RE.test(p)) throw new KvKeyError('parte de clave invalida');
    if (p === '.' || p === '..') throw new KvKeyError('parte de clave invalida');
  }
  const key = `${namespace}:${parts.join(':')}`;
  if (key.length > KV_LIMITS.maxKeyLength) throw new KvKeyError('clave demasiado larga');
  return key as KvKey;
}

// Las tiendas vuelven a comprobar la clave que reciben (el tipo se puede saltar con un cast): una clave que no cumple se trata como ausente.
export function isKvKey(key: unknown): key is KvKey {
  return typeof key === 'string' && key.length <= KV_LIMITS.maxKeyLength && KEY_RE.test(key);
}

// Un nombre de perfil o modelo ('gemini-embedding-001:768:rt') como una sola parte de clave: los ':' pasan a '-'.
export function slugPart(text: string): string {
  return text.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, KV_LIMITS.maxSegmentLength);
}
