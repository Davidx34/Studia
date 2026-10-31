// Lector de la memoria de la clase con cache clave-valor VERSIONADO. Leer el grafo (hasta ~800 KB de jsonb) en cada diseño de laboratorio o evaluacion de cobertura es un viaje pesado a la
// base; como `class_memory.version` sube en cada reconstruccion, un grafo guardado bajo `mem:graph:{clase}:v{version}` es INMUTABLE: nadie vuelve a pedir la version vieja cuando sube la
// siguiente, asi que la invalidacion es perfecta y no hay carreras.
//
// Seguridad: el cache NUNCA salta la autorizacion. La funcion recibe `loadMeta`, una consulta ligera (status, version) que el llamador hace CON LA SESION DEL USUARIO (RLS): sin una fila
// ahi se devuelve `none` y el cache ni se toca. Solo despues se usa la clave interna. Lo que sale del cache se vuelve a validar con readGraph (nunca se confia a ciegas); si no coincide, se
// borra y se recalcula desde la base.

import { buildKvKey, getKv, type KeyValueStore, type KvKey } from '@/lib/kv';
import { readGraph } from './graphRead';
import type { Graph } from './types';

export const GRAPH_CACHE_TTL_SECONDS = 3600;

export interface MemoryMeta {
  status: string;
  version: number;
}
export interface MemoryRow extends MemoryMeta {
  graph: unknown;
}

export type CachedGraph =
  | { kind: 'none' } // no hay memoria para esa clase (o el usuario no puede verla)
  | { kind: 'building' }
  | { kind: 'failed' }
  | { kind: 'ok'; graph: Graph; version: number; cache: 'hit' | 'miss' | 'bypass' };

export interface GraphCacheParams {
  classroomId: string;
  // Consulta ligera (status, version) hecha CON LA SESION del usuario. null = sin fila visible.
  loadMeta: () => Promise<MemoryMeta | null>;
  // Consulta del grafo (version, status, graph), tambien con la sesion del usuario. Solo se llama si el cache no lo tiene.
  loadRow: () => Promise<MemoryRow | null>;
  kv?: KeyValueStore | null; // null = sin cache
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isGraphShape = (v: unknown): v is { concepts: unknown[]; edges: unknown[] } => isObj(v) && Array.isArray(v.concepts) && Array.isArray(v.edges);
const validVersion = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function classify(status: string): 'ready' | 'building' | 'failed' {
  return status === 'ready' ? 'ready' : status === 'building' ? 'building' : 'failed';
}

function graphKey(classroomId: string, version: number): KvKey | null {
  try {
    return buildKvKey('mem', 'graph', classroomId, `v${version}`);
  } catch {
    return null; // un id raro nunca llega al cache
  }
}

export async function getCachedClassGraph(p: GraphCacheParams): Promise<CachedGraph> {
  // 1. AUTORIZACION primero: la fila solo existe para quien la politica deja leerla.
  const meta = await p.loadMeta();
  if (!meta) return { kind: 'none' };
  const state = classify(meta.status);
  if (state !== 'ready') return { kind: state };

  const kv = p.kv === undefined ? getKv() : p.kv;
  const key = kv && validVersion(meta.version) ? graphKey(p.classroomId, meta.version) : null;

  // 2. Cache (ya autorizado).
  if (kv && key) {
    const cached = await kv.get(key, isGraphShape);
    if (cached) {
      const clean = readGraph(cached);
      if (clean.concepts.length === cached.concepts.length && clean.edges.length === cached.edges.length) {
        return { kind: 'ok', graph: clean, version: meta.version, cache: 'hit' };
      }
      await kv.del(key); // algo no paso la validacion: se descarta y se recalcula
    }
  }

  // 3. Fuente de verdad. El par (version, grafo) viene de la MISMA fila: si una reconstruccion termino entre las dos consultas, se guarda bajo la version que de verdad se leyo.
  const row = await p.loadRow();
  if (!row) return { kind: 'none' };
  const rowState = classify(row.status);
  if (rowState !== 'ready') return { kind: rowState };
  const graph = readGraph(row.graph);
  if (!kv || !validVersion(row.version)) return { kind: 'ok', graph, version: row.version, cache: 'bypass' };
  const rowKey = graphKey(p.classroomId, row.version);
  if (rowKey) await kv.set(rowKey, graph, GRAPH_CACHE_TTL_SECONDS);
  return { kind: 'ok', graph, version: row.version, cache: rowKey ? 'miss' : 'bypass' };
}
