// Punto de entrada de la capa clave-valor. Sin variables de Redis: solo memoria (por instancia). Con UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN: L1 (memoria, vida corta, para
// lecturas repetidas en la misma instancia) + L2 (Upstash, compartido entre instancias). Quien use la capa recibe siempre un KeyValueStore que no lanza.

import { MemoryKvStore } from './memoryStore';
import { UpstashHttpKvStore } from './upstashStore';
import { isValidTtl, type KeyValueStore, type KvGuard, type KvKey } from './types';

export * from './types';
export { buildKvKey, isKvKey, slugPart, KV_NAMESPACES, KvKeyError } from './keys';
export { MemoryKvStore } from './memoryStore';
export { UpstashHttpKvStore } from './upstashStore';

// Vida maxima de una copia en L1: corta, porque L1 no se entera de lo que otra instancia cambie en L2.
export const L1_MAX_TTL_SECONDS = 30;

export class TieredKvStore implements KeyValueStore {
  constructor(
    private readonly l1: KeyValueStore,
    private readonly l2: KeyValueStore
  ) {}

  async get<T>(key: KvKey, guard: KvGuard<T>): Promise<T | null> {
    const near = await this.l1.get(key, guard);
    if (near !== null) return near;
    const far = await this.l2.get(key, guard);
    if (far !== null) await this.l1.set(key, far, L1_MAX_TTL_SECONDS);
    return far;
  }

  async set<T>(key: KvKey, value: T, ttlSeconds: number): Promise<void> {
    if (!isValidTtl(ttlSeconds)) return;
    await this.l2.set(key, value, ttlSeconds);
    await this.l1.set(key, value, Math.min(ttlSeconds, L1_MAX_TTL_SECONDS));
  }

  async del(key: KvKey): Promise<void> {
    await this.l1.del(key);
    await this.l2.del(key);
  }

  // Los contadores van SOLO a L2 (compartido): un contador en L1 contaria por instancia y no limitaria nada.
  incrWithWindow(key: KvKey, windowSeconds: number): Promise<{ count: number; ttlSeconds: number }> {
    return this.l2.incrWithWindow(key, windowSeconds);
  }
}

export interface KvEnv {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

// Pura: arma la tienda segun las variables. Una URL que no es https (salvo localhost) se ignora: el token viajaria sin cifrar.
export function createKvFromEnv(env: KvEnv, fetchImpl?: typeof fetch): KeyValueStore {
  const memory = new MemoryKvStore();
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token || !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url)) return memory;
  const remote = new UpstashHttpKvStore({ url, token, fallback: new MemoryKvStore(), fetchImpl });
  return new TieredKvStore(memory, remote);
}

let shared: KeyValueStore | null = null;

// La tienda de esta instancia (se crea una vez).
export function getKv(): KeyValueStore {
  if (!shared) shared = createKvFromEnv({ UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN });
  return shared;
}

// Solo para pruebas.
export function resetKvForTests(store: KeyValueStore | null = null): void {
  shared = store;
}
