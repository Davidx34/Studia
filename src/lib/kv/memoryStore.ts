// Tienda clave-valor EN MEMORIA, por instancia. Sirve como unica capa cuando no hay Redis configurado y como respaldo/L1 cuando si lo hay. En Vercel cada funcion tiene su propia memoria
// y se reinicia en frio: es un acelerador, nunca una fuente de verdad.
//
// Memoria acotada: vencimiento real por TTL (lectura perezosa + poda), y desalojo LRU cuando se supera el tope de CLAVES o de BYTES. Guarda el valor ya serializado: quien lee recibe una
// copia nueva, asi que mutar lo leido no corrompe lo guardado.

import { KV_LIMITS, encodeValue, isValidTtl, utf8Bytes, type KeyValueStore, type KvGuard, type KvKey } from './types';
import { isKvKey } from './keys';

interface Entry {
  text: string;
  bytes: number;
  expiresAt: number; // ms
}

export interface MemoryKvOptions {
  now?: () => number;
  maxKeys?: number;
  maxTotalBytes?: number;
  maxValueBytes?: number;
}

const PRUNE_EVERY_MS = 30_000;

export class MemoryKvStore implements KeyValueStore {
  private readonly entries = new Map<string, Entry>(); // el orden de insercion es el orden LRU (el primero es el menos usado)
  private totalBytes = 0;
  private lastPrune = 0;
  private readonly now: () => number;
  private readonly maxKeys: number;
  private readonly maxTotalBytes: number;
  private readonly maxValueBytes: number;

  constructor(opts: MemoryKvOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.maxKeys = opts.maxKeys ?? KV_LIMITS.memoryMaxKeys;
    this.maxTotalBytes = opts.maxTotalBytes ?? KV_LIMITS.memoryMaxTotalBytes;
    this.maxValueBytes = opts.maxValueBytes ?? KV_LIMITS.maxValueBytes;
  }

  get size(): number {
    return this.entries.size;
  }
  get bytes(): number {
    return this.totalBytes;
  }

  private remove(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.totalBytes -= e.bytes;
    this.entries.delete(key);
  }

  // Quita todo lo vencido.
  private prune(): void {
    const t = this.now();
    this.lastPrune = t;
    for (const [k, e] of Array.from(this.entries)) if (e.expiresAt <= t) this.remove(k);
  }

  // Guarda una entrada y desaloja lo menos usado hasta volver a los topes.
  private put(key: string, text: string, ttlSeconds: number): void {
    const t = this.now();
    if (t - this.lastPrune >= PRUNE_EVERY_MS) this.prune();
    this.remove(key);
    const bytes = utf8Bytes(text);
    this.entries.set(key, { text, bytes, expiresAt: t + ttlSeconds * 1000 });
    this.totalBytes += bytes;
    if (this.entries.size > this.maxKeys || this.totalBytes > this.maxTotalBytes) this.prune(); // primero lo vencido
    while ((this.entries.size > this.maxKeys || this.totalBytes > this.maxTotalBytes) && this.entries.size > 0) {
      const oldest = this.entries.keys().next().value as string;
      this.remove(oldest);
    }
  }

  // Lee una entrada viva y la marca como recien usada. null si no existe o vencio (se borra).
  private touch(key: string): Entry | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.expiresAt <= this.now()) {
      this.remove(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, e);
    return e;
  }

  async get<T>(key: KvKey, guard: KvGuard<T>): Promise<T | null> {
    if (!isKvKey(key)) return null;
    const e = this.touch(key);
    if (!e) return null;
    try {
      const value: unknown = JSON.parse(e.text);
      if (guard(value)) return value;
    } catch {
      // cae al borrado
    }
    this.remove(key); // corrupto o con otra forma: se descarta
    return null;
  }

  async set<T>(key: KvKey, value: T, ttlSeconds: number): Promise<void> {
    if (!isKvKey(key) || !isValidTtl(ttlSeconds)) return;
    const text = encodeValue(value, this.maxValueBytes);
    if (text === null) return;
    this.put(key, text, ttlSeconds);
  }

  async del(key: KvKey): Promise<void> {
    if (isKvKey(key)) this.remove(key);
  }

  async incrWithWindow(key: KvKey, windowSeconds: number): Promise<{ count: number; ttlSeconds: number }> {
    if (!isKvKey(key) || !isValidTtl(windowSeconds)) return { count: 0, ttlSeconds: 0 };
    const t = this.now();
    const live = this.touch(key);
    if (!live) {
      this.put(key, '1', windowSeconds);
      return { count: 1, ttlSeconds: Math.ceil(windowSeconds) };
    }
    const count = (Number(live.text) || 0) + 1;
    live.text = String(count); // la ventana (expiresAt) no se mueve: es ventana FIJA
    const bytes = utf8Bytes(live.text);
    this.totalBytes += bytes - live.bytes;
    live.bytes = bytes;
    return { count, ttlSeconds: Math.max(1, Math.ceil((live.expiresAt - t) / 1000)) };
  }
}
