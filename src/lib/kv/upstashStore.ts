// Cliente de Upstash Redis por su API REST (solo `fetch`, sin SDK). Compartido entre todas las instancias de Vercel.
//
// Nunca rompe ni frena la peticion del usuario:
//  - cada llamada tiene un limite de tiempo agresivo (800 ms);
//  - ante error, timeout o respuesta rara, la operacion se atiende en el respaldo en memoria y se cuenta la falla;
//  - tras 3 fallas seguidas se ABRE un cortacircuito 30 s: en ese lapso ni se intenta la red.
// Limite conocido: una escritura/borrado hecho mientras Redis esta caido queda solo en el respaldo; al volver Redis puede conservar una copia vieja de esa clave (las claves por version
// de este proyecto son inmutables, asi que no importa; para otro uso habria que tenerlo en cuenta).

import { KV_LIMITS, encodeValue, isValidTtl, type KeyValueStore, type KvGuard, type KvKey } from './types';
import { isKvKey } from './keys';

export interface UpstashOptions {
  url: string;
  token: string;
  fallback: KeyValueStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  failuresToOpen?: number;
  openMs?: number;
}

type Cmd = (string | number)[];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export class UpstashHttpKvStore implements KeyValueStore {
  private readonly url: string;
  private readonly token: string;
  private readonly fallback: KeyValueStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly failuresToOpen: number;
  private readonly openMs: number;
  private failures = 0;
  private openUntil = 0;

  constructor(o: UpstashOptions) {
    this.url = o.url.replace(/\/+$/, '');
    this.token = o.token;
    this.fallback = o.fallback;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.now = o.now ?? Date.now;
    this.timeoutMs = o.timeoutMs ?? 800;
    this.failuresToOpen = o.failuresToOpen ?? 3;
    this.openMs = o.openMs ?? 30_000;
  }

  get circuitOpen(): boolean {
    return this.now() < this.openUntil;
  }

  private fail(): void {
    this.failures += 1;
    if (this.failures >= this.failuresToOpen) {
      this.openUntil = this.now() + this.openMs;
      this.failures = 0;
    }
  }

  // Ejecuta una peticion REST; null ante cualquier problema (sin lanzar).
  private async call(path: string, body: unknown): Promise<unknown | null> {
    if (this.circuitOpen) return null;
    try {
      const res = await this.fetchImpl(this.url + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        this.fail();
        return null;
      }
      const json: unknown = await res.json();
      this.failures = 0;
      return json;
    } catch {
      this.fail();
      return null;
    }
  }

  private async cmd(c: Cmd): Promise<{ ok: true; result: unknown } | { ok: false }> {
    const json = await this.call('', c);
    if (!isObj(json) || 'error' in json || !('result' in json)) {
      if (json !== null) this.fail(); // respondio, pero con error o forma inesperada
      return { ok: false };
    }
    return { ok: true, result: json.result };
  }

  async get<T>(key: KvKey, guard: KvGuard<T>): Promise<T | null> {
    if (!isKvKey(key)) return null;
    const r = await this.cmd(['GET', key]);
    if (!r.ok) return this.fallback.get(key, guard);
    if (r.result === null) return null;
    try {
      if (typeof r.result === 'string') {
        const value: unknown = JSON.parse(r.result);
        if (guard(value)) return value;
      }
    } catch {
      // cae al borrado
    }
    await this.cmd(['DEL', key]); // corrupto o con otra forma: se descarta
    return null;
  }

  async set<T>(key: KvKey, value: T, ttlSeconds: number): Promise<void> {
    if (!isKvKey(key) || !isValidTtl(ttlSeconds)) return;
    const text = encodeValue(value, KV_LIMITS.maxValueBytes);
    if (text === null) return;
    const r = await this.cmd(['SET', key, text, 'EX', Math.ceil(ttlSeconds)]);
    if (!r.ok) await this.fallback.set(key, value, ttlSeconds);
  }

  async del(key: KvKey): Promise<void> {
    if (!isKvKey(key)) return;
    const r = await this.cmd(['DEL', key]);
    if (!r.ok) await this.fallback.del(key);
  }

  async incrWithWindow(key: KvKey, windowSeconds: number): Promise<{ count: number; ttlSeconds: number }> {
    if (!isKvKey(key) || !isValidTtl(windowSeconds)) return { count: 0, ttlSeconds: 0 };
    // INCR + EXPIRE NX + TTL en una transaccion: o el contador nace con vencimiento o no nace (nunca queda una clave eterna).
    const json = await this.call('/multi-exec', [
      ['INCR', key],
      ['EXPIRE', key, Math.ceil(windowSeconds), 'NX'],
      ['TTL', key],
    ]);
    if (Array.isArray(json) && json.length === 3 && json.every((x) => isObj(x) && !('error' in x))) {
      const count = (json[0] as { result?: unknown }).result;
      const ttl = (json[2] as { result?: unknown }).result;
      if (typeof count === 'number' && Number.isFinite(count) && typeof ttl === 'number' && Number.isFinite(ttl)) {
        return { count, ttlSeconds: ttl > 0 ? ttl : Math.ceil(windowSeconds) };
      }
    }
    if (json !== null) this.fail();
    return this.fallback.incrWithWindow(key, windowSeconds);
  }
}
