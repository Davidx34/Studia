import { describe, expect, it, vi } from 'vitest';
import { KV_LIMITS, buildKvKey, createKvFromEnv, isKvKey, slugPart, MemoryKvStore, TieredKvStore, UpstashHttpKvStore, L1_MAX_TTL_SECONDS, type KeyValueStore, type KvKey } from './index';
import { EMBEDDING_DIMENSIONS, QUERY_EMBED_TTL_SECONDS, embedQuery, isEmbeddingVector, queryEmbedKey } from '@/lib/embeddings/embed';
import { GRAPH_CACHE_TTL_SECONDS, getCachedClassGraph, type MemoryRow } from '@/lib/memory/graphCache';

const isNum = (v: unknown): v is number => typeof v === 'number';
const isStr = (v: unknown): v is string => typeof v === 'string';
const isAny = (_v: unknown): _v is unknown => true;
const K = (...p: string[]) => buildKvKey('mem', ...p);

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (s: number) => (t += s * 1000) };
}

// ------------------------------------------------------------------ claves
describe('buildKvKey: claves anti-inyeccion', () => {
  it('arma espacio:partes', () => {
    expect(buildKvKey('emb', 'q', 'abc')).toBe('emb:q:abc');
    expect(buildKvKey('mem', 'graph', '0f8fad5b-d9cb-469f-a165-70867728950e', 'v3')).toBe('mem:graph:0f8fad5b-d9cb-469f-a165-70867728950e:v3');
  });
  it.each([
    ['con dos puntos', 'a:b'],
    ['con asterisco', 'a*'],
    ['con espacio', 'a b'],
    ['con salto de linea', 'a\nb'],
    ['con barra', 'a/b'],
    ['vacia', ''],
    ['punto solo', '.'],
    ['dos puntos seguidos', '..'],
    ['demasiado larga', 'x'.repeat(81)],
    ['con acento', 'á'],
  ])('rechaza una parte %s', (_n, part) => {
    expect(() => buildKvKey('emb', part)).toThrow();
  });
  it('acepta una parte de exactamente 80 caracteres', () => {
    expect(() => buildKvKey('emb', 'x'.repeat(80))).not.toThrow();
  });
  it('rechaza espacios de nombres desconocidos y cantidades invalidas de partes', () => {
    expect(() => buildKvKey('admin' as any, 'a')).toThrow();
    expect(() => buildKvKey('emb')).toThrow();
    expect(() => buildKvKey('emb', 'a', 'b', 'c', 'd', 'e', 'f')).not.toThrow(); // 6 partes
    expect(() => buildKvKey('emb', 'a', 'b', 'c', 'd', 'e', 'f', 'g')).toThrow(); // 7
  });
  it('rechaza una clave total demasiado larga', () => {
    const p = 'x'.repeat(80);
    expect(() => buildKvKey('emb', p, p, p, p)).toThrow(); // 3 + 4*81 > 250
  });
  it('quien aporta una parte no puede saltar de emb: a quota:', () => {
    expect(() => buildKvKey('emb', 'q:quota:otro')).toThrow();
    expect(buildKvKey('emb', 'q', 'quota').startsWith('emb:')).toBe(true);
  });
  it('isKvKey: solo claves bien formadas (el tipo se puede saltar con un cast)', () => {
    expect(isKvKey('emb:q:abc')).toBe(true);
    expect(isKvKey('foo:bar')).toBe(false);
    expect(isKvKey('emb:')).toBe(false);
    expect(isKvKey('emb:a b')).toBe(false);
    expect(isKvKey('emb:*')).toBe(false);
    expect(isKvKey(42)).toBe(false);
    expect(isKvKey('emb:' + 'x'.repeat(300))).toBe(false);
  });
  it('slugPart convierte un perfil en una sola parte', () => {
    expect(slugPart('gemini-embedding-001:768:rt')).toBe('gemini-embedding-001-768-rt');
    expect(slugPart('a b*c').includes('*')).toBe(false);
    expect(slugPart('x'.repeat(200)).length).toBe(KV_LIMITS.maxSegmentLength);
  });
});

// ------------------------------------------------------------------ memoria
describe('MemoryKvStore', () => {
  it('guarda y lee; lo leido es una copia (mutarla no corrompe lo guardado)', async () => {
    const s = new MemoryKvStore();
    await s.set(K('a'), { x: [1, 2] }, 60);
    const v = await s.get(K('a'), isAny);
    (v as any).x.push(99);
    expect(await s.get(K('a'), isAny)).toEqual({ x: [1, 2] });
  });
  it('vence por TTL: justo antes sigue, justo en el limite ya no', async () => {
    const c = clock();
    const s = new MemoryKvStore({ now: c.now });
    await s.set(K('a'), 1, 10);
    c.advance(9.999);
    expect(await s.get(K('a'), isNum)).toBe(1);
    c.advance(0.001);
    expect(await s.get(K('a'), isNum)).toBeNull();
    expect(s.size).toBe(0);
    expect(s.bytes).toBe(0);
  });
  it.each([0, -5, 0.5, NaN, Infinity, KV_LIMITS.maxTtlSeconds + 1, '60' as any, null as any])('no guarda con un TTL invalido (%s)', async (ttl) => {
    const s = new MemoryKvStore();
    await s.set(K('a'), 1, ttl);
    expect(await s.get(K('a'), isAny)).toBeNull();
  });
  it('acepta los extremos del TTL', async () => {
    const s = new MemoryKvStore();
    await s.set(K('a'), 1, KV_LIMITS.minTtlSeconds);
    await s.set(K('b'), 2, KV_LIMITS.maxTtlSeconds);
    expect(await s.get(K('a'), isNum)).toBe(1);
    expect(await s.get(K('b'), isNum)).toBe(2);
  });
  it('desaloja lo MENOS usado al superar el tope de claves (leer cuenta como usar)', async () => {
    const s = new MemoryKvStore({ maxKeys: 3 });
    await s.set(K('a'), 1, 60);
    await s.set(K('b'), 2, 60);
    await s.set(K('c'), 3, 60);
    await s.get(K('a'), isNum); // a pasa a ser la mas reciente
    await s.set(K('d'), 4, 60);
    expect(s.size).toBe(3);
    expect(await s.get(K('b'), isNum)).toBeNull(); // la menos usada
    expect(await s.get(K('a'), isNum)).toBe(1);
    expect(await s.get(K('c'), isNum)).toBe(3);
    expect(await s.get(K('d'), isNum)).toBe(4);
  });
  it('reescribir una clave no la duplica ni deja bytes de mas', async () => {
    const s = new MemoryKvStore({ maxKeys: 5 });
    await s.set(K('a'), 'x'.repeat(100), 60);
    const before = s.bytes;
    await s.set(K('a'), 'x'.repeat(100), 60);
    expect(s.size).toBe(1);
    expect(s.bytes).toBe(before);
  });
  it('desaloja por BYTES aunque haya pocas claves', async () => {
    const s = new MemoryKvStore({ maxTotalBytes: 300, maxValueBytes: 200 });
    await s.set(K('a'), 'a'.repeat(100), 60); // 102 bytes con comillas
    await s.set(K('b'), 'b'.repeat(100), 60);
    await s.set(K('c'), 'c'.repeat(100), 60); // 306 > 300 -> sale a
    expect(await s.get(K('a'), isStr)).toBeNull();
    expect(await s.get(K('b'), isStr)).not.toBeNull();
    expect(await s.get(K('c'), isStr)).not.toBeNull();
    expect(s.bytes).toBeLessThanOrEqual(300);
  });
  it('al estar lleno, primero se van las claves VENCIDAS y no las vivas', async () => {
    const c = clock();
    const s = new MemoryKvStore({ now: c.now, maxKeys: 2 });
    await s.set(K('viva'), 1, 600);
    await s.set(K('corta'), 2, 5);
    c.advance(10); // 'corta' vencio pero sigue ocupando lugar
    await s.set(K('nueva'), 3, 60);
    expect(await s.get(K('viva'), isNum)).toBe(1); // sin la poda previa se habria ido por ser la mas antigua
    expect(await s.get(K('nueva'), isNum)).toBe(3);
  });
  it('un valor mas grande que el tope por valor no se guarda', async () => {
    const s = new MemoryKvStore({ maxValueBytes: 50 });
    await s.set(K('a'), 'x'.repeat(100), 60);
    expect(await s.get(K('a'), isAny)).toBeNull();
    await s.set(K('b'), 'x'.repeat(40), 60);
    expect(await s.get(K('b'), isAny)).not.toBeNull();
  });
  it('el tope por valor cuenta BYTES, no caracteres', async () => {
    const s = new MemoryKvStore({ maxValueBytes: 30 });
    await s.set(K('a'), 'ñ'.repeat(20), 60); // 20 caracteres, 40+2 bytes
    expect(await s.get(K('a'), isAny)).toBeNull();
  });
  it('no guarda lo que no es JSON (undefined, funciones, ciclos)', async () => {
    const s = new MemoryKvStore();
    const cyc: any = {};
    cyc.self = cyc;
    await s.set(K('u'), undefined, 60);
    await s.set(K('f'), () => 1, 60);
    await s.set(K('c'), cyc, 60);
    expect(s.size).toBe(0);
  });
  it('un valor que NO pasa el validador se borra y se trata como ausente', async () => {
    const s = new MemoryKvStore();
    await s.set(K('a'), 'texto', 60);
    expect(await s.get(K('a'), isNum)).toBeNull();
    expect(s.size).toBe(0); // se borro
    expect(await s.get(K('a'), isStr)).toBeNull();
  });
  it('del borra y es inofensivo si no existe', async () => {
    const s = new MemoryKvStore();
    await s.set(K('a'), 1, 60);
    await s.del(K('a'));
    await s.del(K('nunca'));
    expect(await s.get(K('a'), isNum)).toBeNull();
    expect(s.bytes).toBe(0);
  });
  it('rechaza claves que no vienen de buildKvKey aunque se fuerce el tipo', async () => {
    const s = new MemoryKvStore();
    await s.set('cualquier cosa*' as KvKey, 1, 60);
    expect(s.size).toBe(0);
    expect(await s.get('cualquier cosa*' as KvKey, isAny)).toBeNull();
    expect(await s.incrWithWindow('x*' as KvKey, 60)).toEqual({ count: 0, ttlSeconds: 0 });
  });
  describe('incrWithWindow (ventana fija)', () => {
    it('cuenta y la ventana NO se mueve con cada golpe', async () => {
      const c = clock();
      const s = new MemoryKvStore({ now: c.now });
      expect(await s.incrWithWindow(K('q'), 60)).toEqual({ count: 1, ttlSeconds: 60 });
      c.advance(20);
      expect(await s.incrWithWindow(K('q'), 60)).toEqual({ count: 2, ttlSeconds: 40 });
      c.advance(30);
      expect(await s.incrWithWindow(K('q'), 60)).toEqual({ count: 3, ttlSeconds: 10 });
    });
    it('al vencer la ventana empieza de nuevo', async () => {
      const c = clock();
      const s = new MemoryKvStore({ now: c.now });
      await s.incrWithWindow(K('q'), 60);
      await s.incrWithWindow(K('q'), 60);
      c.advance(60);
      expect(await s.incrWithWindow(K('q'), 60)).toEqual({ count: 1, ttlSeconds: 60 });
    });
    it('cada clave cuenta por separado y los bytes no se desvian al pasar de 9 a 10', async () => {
      const s = new MemoryKvStore();
      for (let i = 0; i < 12; i++) await s.incrWithWindow(K('a'), 60);
      expect((await s.incrWithWindow(K('b'), 60)).count).toBe(1);
      expect(s.bytes).toBe(2 + 1); // "13" y "1"
      await s.del(K('a'));
      await s.del(K('b'));
      expect(s.bytes).toBe(0);
    });
    it('rechaza una ventana invalida', async () => {
      const s = new MemoryKvStore();
      expect(await s.incrWithWindow(K('q'), 0)).toEqual({ count: 0, ttlSeconds: 0 });
      expect(s.size).toBe(0);
    });
  });
});

// ------------------------------------------------------------------ Upstash
function resp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function upstash(fetchImpl: any, over: Partial<ConstructorParameters<typeof UpstashHttpKvStore>[0]> = {}) {
  const fallback = new MemoryKvStore();
  const c = clock();
  const store = new UpstashHttpKvStore({ url: 'https://redis.example.io/', token: 'TKN', fallback, fetchImpl, now: c.now, ...over });
  return { store, fallback, c };
}

describe('UpstashHttpKvStore', () => {
  it('SET con EX y la cabecera Authorization; GET valida lo que vuelve', async () => {
    const f = vi.fn(async () => resp({ result: 'OK' }));
    const { store } = upstash(f);
    await store.set(K('a'), { n: 1 }, 90.2);
    const [url, init] = f.mock.calls[0] as any[];
    expect(url).toBe('https://redis.example.io'); // sin barra final duplicada
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer TKN');
    expect(JSON.parse(init.body)).toEqual(['SET', 'mem:a', '{"n":1}', 'EX', 91]);

    f.mockImplementationOnce(async () => resp({ result: '{"n":1}' }));
    expect(await store.get(K('a'), (v): v is { n: number } => isNum((v as any)?.n))).toEqual({ n: 1 });
  });
  it('GET con result null es ausencia, sin tocar el respaldo ni borrar nada', async () => {
    const f = vi.fn(async () => resp({ result: null }));
    const { store } = upstash(f);
    expect(await store.get(K('a'), isAny)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('un valor que no pasa el validador se borra en Redis y da null', async () => {
    const f = vi.fn(async (_u: string, init: any) => (JSON.parse(init.body)[0] === 'GET' ? resp({ result: '"texto"' }) : resp({ result: 1 })));
    const { store } = upstash(f);
    expect(await store.get(K('a'), isNum)).toBeNull();
    expect(f.mock.calls.map((c: any[]) => JSON.parse(c[1].body)[0])).toEqual(['GET', 'DEL']);
  });
  it('un valor corrupto (no JSON) tambien se borra', async () => {
    const f = vi.fn(async (_u: string, init: any) => (JSON.parse(init.body)[0] === 'GET' ? resp({ result: '{roto' }) : resp({ result: 1 })));
    const { store } = upstash(f);
    expect(await store.get(K('a'), isAny)).toBeNull();
    expect(f.mock.calls.map((c: any[]) => JSON.parse(c[1].body)[0])).toEqual(['GET', 'DEL']);
  });
  it('HTTP 500: no lanza y atiende desde el respaldo en memoria', async () => {
    const f = vi.fn(async () => resp({ error: 'boom' }, 500));
    const { store, fallback } = upstash(f);
    await expect(store.set(K('a'), 7, 60)).resolves.toBeUndefined();
    expect(await fallback.get(K('a'), isNum)).toBe(7);
    expect(await store.get(K('a'), isNum)).toBe(7);
    await expect(store.del(K('a'))).resolves.toBeUndefined();
    expect(await fallback.get(K('a'), isNum)).toBeNull();
  });
  it.each([
    ['la red falla', () => Promise.reject(new TypeError('network'))],
    ['el tiempo se agota', () => Promise.reject(new DOMException('timeout', 'TimeoutError'))],
    ['la respuesta no es JSON', async () => new Response('<html>', { status: 200 })],
    ['responde un error de Redis', async () => resp({ error: 'ERR wrong' })],
    ['responde una forma rara', async () => resp({ otra: 1 })],
    ['responde un error junto a un resultado', async () => resp({ error: 'ERR', result: '1' })],
  ])('si %s, degrada en silencio', async (_n, impl) => {
    const f = vi.fn(impl as any);
    const { store, fallback } = upstash(f);
    await expect(store.set(K('a'), 1, 60)).resolves.toBeUndefined();
    expect(await fallback.get(K('a'), isNum)).toBe(1);
    await expect(store.get(K('a'), isNum)).resolves.toBe(1);
    await expect(store.incrWithWindow(K('c'), 60)).resolves.toEqual({ count: 1, ttlSeconds: 60 });
  });
  it('lleva un limite de tiempo en cada peticion (señal de aborto)', async () => {
    const f = vi.fn(async () => resp({ result: 'OK' }));
    const { store } = upstash(f);
    await store.set(K('a'), 1, 60);
    expect((f.mock.calls[0] as any[])[1].signal).toBeInstanceOf(AbortSignal);
  });
  it('un fetch que NUNCA responde se corta por el limite de tiempo real', async () => {
    const f = vi.fn((_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('timeout', 'TimeoutError')))));
    const { store, fallback } = upstash(f, { timeoutMs: 30 });
    const t0 = Date.now();
    await store.set(K('a'), 1, 60);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(await fallback.get(K('a'), isNum)).toBe(1);
  });
  describe('cortacircuito', () => {
    it('tras 3 fallas seguidas deja de intentar la red 30 s y luego vuelve a probar', async () => {
      const f = vi.fn(async () => resp({ error: 'x' }, 503));
      const { store, c } = upstash(f);
      for (let i = 0; i < 3; i++) await store.get(K('a'), isAny);
      expect(f).toHaveBeenCalledTimes(3);
      expect(store.circuitOpen).toBe(true);
      await store.get(K('a'), isAny);
      await store.set(K('a'), 1, 60);
      expect(f).toHaveBeenCalledTimes(3); // no toco la red
      c.advance(29.9);
      expect(store.circuitOpen).toBe(true);
      c.advance(0.2);
      expect(store.circuitOpen).toBe(false);
      await store.get(K('a'), isAny);
      expect(f).toHaveBeenCalledTimes(4);
    });
    it('dos fallas no lo abren, y un exito reinicia la cuenta', async () => {
      let fail = true;
      const f = vi.fn(async () => (fail ? resp({ error: 'x' }, 500) : resp({ result: null })));
      const { store } = upstash(f);
      await store.get(K('a'), isAny);
      await store.get(K('a'), isAny);
      expect(store.circuitOpen).toBe(false);
      fail = false;
      await store.get(K('a'), isAny); // exito: reinicia
      fail = true;
      await store.get(K('a'), isAny);
      await store.get(K('a'), isAny);
      expect(store.circuitOpen).toBe(false); // 2 desde el exito, no 4
    });
    it('el contador sigue respondiendo con el respaldo mientras esta abierto', async () => {
      const f = vi.fn(async () => resp({ error: 'x' }, 500));
      const { store } = upstash(f);
      for (let i = 0; i < 3; i++) await store.get(K('a'), isAny);
      expect((await store.incrWithWindow(K('q'), 60)).count).toBe(1);
      expect((await store.incrWithWindow(K('q'), 60)).count).toBe(2);
    });
  });
  describe('incrWithWindow', () => {
    it('hace INCR + EXPIRE NX + TTL en UNA transaccion (multi-exec)', async () => {
      const f = vi.fn(async () => resp([{ result: 4 }, { result: 1 }, { result: 37 }]));
      const { store } = upstash(f);
      expect(await store.incrWithWindow(K('q'), 60)).toEqual({ count: 4, ttlSeconds: 37 });
      const [url, init] = f.mock.calls[0] as any[];
      expect(url).toBe('https://redis.example.io/multi-exec');
      expect(JSON.parse(init.body)).toEqual([['INCR', 'mem:q'], ['EXPIRE', 'mem:q', 60, 'NX'], ['TTL', 'mem:q']]);
    });
    it('si Redis no devuelve TTL (-1/-2) usa la ventana pedida', async () => {
      const f = vi.fn(async () => resp([{ result: 1 }, { result: 0 }, { result: -1 }]));
      const { store } = upstash(f);
      expect(await store.incrWithWindow(K('q'), 60)).toEqual({ count: 1, ttlSeconds: 60 });
    });
    it.each([
      ['un error dentro del lote', [{ result: 1 }, { error: 'ERR' }, { result: 5 }]],
      ['un lote incompleto', [{ result: 1 }]],
      ['un conteo que no es numero', [{ result: 'x' }, { result: 1 }, { result: 5 }]],
    ])('con %s usa el respaldo', async (_n, body) => {
      const f = vi.fn(async () => resp(body));
      const { store } = upstash(f);
      expect(await store.incrWithWindow(K('q'), 60)).toEqual({ count: 1, ttlSeconds: 60 });
    });
  });
  it('no llama a la red con una clave invalida o un TTL invalido', async () => {
    const f = vi.fn(async () => resp({ result: 'OK' }));
    const { store } = upstash(f);
    await store.set('mala*' as KvKey, 1, 60);
    await store.get('mala*' as KvKey, isAny);
    await store.del('mala*' as KvKey);
    await store.set(K('a'), 1, 0);
    await store.set(K('a'), undefined, 60);
    await store.set(K('a'), 'x'.repeat(KV_LIMITS.maxValueBytes + 1), 60);
    await store.incrWithWindow(K('a'), 0);
    expect(f).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ enrutador
describe('TieredKvStore y createKvFromEnv', () => {
  function tier() {
    const l1 = new MemoryKvStore();
    const l2 = new MemoryKvStore();
    return { l1, l2, t: new TieredKvStore(l1, l2) };
  }
  it('una lectura en L2 deja una copia en L1', async () => {
    const { l1, l2, t } = tier();
    await l2.set(K('a'), 5, 600);
    expect(await l1.get(K('a'), isNum)).toBeNull();
    expect(await t.get(K('a'), isNum)).toBe(5);
    expect(await l1.get(K('a'), isNum)).toBe(5);
  });
  it('set escribe en ambos; L1 vive como maximo 30 s', async () => {
    const c = clock();
    const l1 = new MemoryKvStore({ now: c.now });
    const l2 = new MemoryKvStore({ now: c.now });
    const t = new TieredKvStore(l1, l2);
    await t.set(K('a'), 1, 3600);
    c.advance(L1_MAX_TTL_SECONDS + 1);
    expect(await l1.get(K('a'), isNum)).toBeNull();
    expect(await l2.get(K('a'), isNum)).toBe(1);
  });
  it('set con TTL invalido no escribe en ninguno', async () => {
    const { l1, l2, t } = tier();
    await t.set(K('a'), 1, 0);
    expect(l1.size + l2.size).toBe(0);
  });
  it('un TTL menor que 30 s tambien limita a L1', async () => {
    const c = clock();
    const l1 = new MemoryKvStore({ now: c.now });
    const t = new TieredKvStore(l1, new MemoryKvStore({ now: c.now }));
    await t.set(K('a'), 1, 5);
    c.advance(6);
    expect(await l1.get(K('a'), isNum)).toBeNull();
  });
  it('del borra en ambos', async () => {
    const { l1, l2, t } = tier();
    await t.set(K('a'), 1, 60);
    await t.del(K('a'));
    expect(l1.size + l2.size).toBe(0);
  });
  it('los contadores van SOLO a L2', async () => {
    const { l1, l2, t } = tier();
    await t.incrWithWindow(K('q'), 60);
    await t.incrWithWindow(K('q'), 60);
    expect(l1.size).toBe(0);
    expect((await l2.incrWithWindow(K('q'), 60)).count).toBe(3);
  });
  it('un valor que L1 tiene mal formado se descarta y se mira L2', async () => {
    const { l1, l2, t } = tier();
    await l1.set(K('a'), 'texto', 60);
    await l2.set(K('a'), 9, 60);
    expect(await t.get(K('a'), isNum)).toBe(9);
  });
  it('sin variables: solo memoria', () => {
    expect(createKvFromEnv({})).toBeInstanceOf(MemoryKvStore);
    expect(createKvFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x.io' })).toBeInstanceOf(MemoryKvStore);
    expect(createKvFromEnv({ UPSTASH_REDIS_REST_TOKEN: 't' })).toBeInstanceOf(MemoryKvStore);
    expect(createKvFromEnv({ UPSTASH_REDIS_REST_URL: '  ', UPSTASH_REDIS_REST_TOKEN: 't' })).toBeInstanceOf(MemoryKvStore);
  });
  it('con las dos variables: L1 + Upstash', () => {
    expect(createKvFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' })).toBeInstanceOf(TieredKvStore);
    expect(createKvFromEnv({ UPSTASH_REDIS_REST_URL: 'http://localhost:8079', UPSTASH_REDIS_REST_TOKEN: 't' })).toBeInstanceOf(TieredKvStore);
  });
  it('una URL sin cifrar que no es local se ignora (el token viajaria en claro)', () => {
    expect(createKvFromEnv({ UPSTASH_REDIS_REST_URL: 'http://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' })).toBeInstanceOf(MemoryKvStore);
    expect(createKvFromEnv({ UPSTASH_REDIS_REST_URL: 'http://localhost.evil.com', UPSTASH_REDIS_REST_TOKEN: 't' })).toBeInstanceOf(MemoryKvStore);
    expect(createKvFromEnv({ UPSTASH_REDIS_REST_URL: 'ftp://x.io', UPSTASH_REDIS_REST_TOKEN: 't' })).toBeInstanceOf(MemoryKvStore);
  });
});

// ------------------------------------------------------------------ cache de embeddings
const VEC = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i % 7) + 1);

function geminiFetch(sequence: Array<'ok' | 'fail'> = []) {
  let i = 0;
  return vi.fn(async () => {
    const mode = sequence[i++] ?? 'ok';
    return mode === 'ok' ? resp({ embedding: { values: VEC } }) : resp({ error: 'x' }, 500);
  });
}

describe('embedQuery con cache clave-valor', () => {
  it('una consulta repetida NO vuelve a llamar a la API', async () => {
    const kv = new MemoryKvStore();
    const f = geminiFetch();
    const a = await embedQuery('que es la inflacion', { apiKey: 'k', fetchImpl: f as any, kv });
    const b = await embedQuery('que es la inflacion', { apiKey: 'k', fetchImpl: f as any, kv });
    expect(f).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
  });
  it('un texto distinto si llama', async () => {
    const kv = new MemoryKvStore();
    const f = geminiFetch();
    await embedQuery('uno', { apiKey: 'k', fetchImpl: f as any, kv });
    await embedQuery('dos', { apiKey: 'k', fetchImpl: f as any, kv });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('espacios de mas no cambian la clave, pero mayusculas si', async () => {
    const kv = new MemoryKvStore();
    const f = geminiFetch();
    await embedQuery('que  es la   inflacion ', { apiKey: 'k', fetchImpl: f as any, kv });
    await embedQuery(' que es la inflacion', { apiKey: 'k', fetchImpl: f as any, kv });
    expect(f).toHaveBeenCalledTimes(1);
    await embedQuery('QUE ES LA INFLACION', { apiKey: 'k', fetchImpl: f as any, kv });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('una FALLA no se guarda: el siguiente intento vuelve a llamar', async () => {
    const kv = new MemoryKvStore();
    const f = geminiFetch(['fail', 'ok']);
    expect(await embedQuery('x', { apiKey: 'k', fetchImpl: f as any, kv })).toBeNull();
    expect(await embedQuery('x', { apiKey: 'k', fetchImpl: f as any, kv })).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('guarda con el TTL de un dia', async () => {
    const kv = new MemoryKvStore();
    const spy = vi.spyOn(kv, 'set');
    await embedQuery('x', { apiKey: 'k', fetchImpl: geminiFetch() as any, kv });
    expect(QUERY_EMBED_TTL_SECONDS).toBe(86400);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toBe(86400);
    expect(spy.mock.calls[0][0]).toMatch(/^emb:q:/);
  });
  it('un vector envenenado en el cache (dimension o numeros malos) se descarta y se recalcula', async () => {
    for (const bad of [[1, 2, 3], Array(EMBEDDING_DIMENSIONS).fill('a'), [...VEC.slice(1), null], 'texto', { values: VEC }]) {
      const kv = new MemoryKvStore();
      await kv.set((await queryEmbedKey('x'))!, bad, 60);
      const f = geminiFetch();
      const r = await embedQuery('x', { apiKey: 'k', fetchImpl: f as any, kv });
      expect(f).toHaveBeenCalledTimes(1);
      expect(r).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(kv.size).toBe(1);
    }
  });
  it('isEmbeddingVector exige la dimension exacta y solo numeros finitos', () => {
    expect(isEmbeddingVector(VEC)).toBe(true);
    expect(isEmbeddingVector(VEC.slice(1))).toBe(false);
    expect(isEmbeddingVector([...VEC, 1])).toBe(false);
    expect(isEmbeddingVector([...VEC.slice(1), NaN])).toBe(false);
    expect(isEmbeddingVector([...VEC.slice(1), Infinity])).toBe(false);
    expect(isEmbeddingVector(null)).toBe(false);
  });
  it('sin cache (kv: null) o con normalize:false siempre llama', async () => {
    const f = geminiFetch();
    await embedQuery('x', { apiKey: 'k', fetchImpl: f as any, kv: null });
    await embedQuery('x', { apiKey: 'k', fetchImpl: f as any, kv: null });
    expect(f).toHaveBeenCalledTimes(2);
    const kv = new MemoryKvStore();
    await embedQuery('y', { apiKey: 'k', fetchImpl: f as any, kv, normalize: false });
    await embedQuery('y', { apiKey: 'k', fetchImpl: f as any, kv, normalize: false });
    expect(f).toHaveBeenCalledTimes(4);
    expect(kv.size).toBe(0);
  });
  it('un texto vacio no llama ni guarda', async () => {
    const kv = new MemoryKvStore();
    const f = geminiFetch();
    expect(await embedQuery('   ', { apiKey: 'k', fetchImpl: f as any, kv })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(kv.size).toBe(0);
  });
  it('la clave lleva el perfil y un hash: nunca el texto de la consulta', async () => {
    const key = (await queryEmbedKey('Mi texto secreto de consulta'))!;
    expect(key).toMatch(/^emb:q:gemini-embedding-001-768-rt:[0-9a-f]{64}$/);
    expect(key).not.toContain('secreto');
    expect(await queryEmbedKey('otro')).not.toBe(key);
    expect(await queryEmbedKey('Mi texto secreto de consulta', 'otro-perfil:1')).not.toBe(key); // otro perfil, otro vector
    expect(await queryEmbedKey('   ')).toBeNull();
  });
  it('si el cache esta caido no rompe la busqueda', async () => {
    const broken: KeyValueStore = { get: async () => null, set: async () => undefined, del: async () => undefined, incrWithWindow: async () => ({ count: 0, ttlSeconds: 0 }) };
    const f = geminiFetch();
    expect(await embedQuery('x', { apiKey: 'k', fetchImpl: f as any, kv: broken })).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});

// ------------------------------------------------------------------ cache versionado de la memoria
const CLASS_A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CLASS_B = '1a8fad5b-d9cb-469f-a165-70867728950f';
const concept = (key: string) => ({ key, name: key, kind: 'concepto', definition: 'd', formula: '', unit: '', importance: 3, mentions: 1, sources: [] });
const graphV = (n: number) => ({ concepts: Array.from({ length: n }, (_, i) => concept(`c${i}`)), edges: [] });

function memoryDb(initial: { status: string; version: number; graph: unknown } | null) {
  const state = { row: initial };
  const calls = { meta: 0, row: 0 };
  return {
    state,
    calls,
    loadMeta: async () => {
      calls.meta++;
      return state.row ? { status: state.row.status, version: state.row.version } : null;
    },
    loadRow: async (): Promise<MemoryRow | null> => {
      calls.row++;
      return state.row ? { ...state.row } : null;
    },
  };
}

describe('getCachedClassGraph', () => {
  it('primera lectura: va a la base y guarda; la segunda sale del cache', async () => {
    const kv = new MemoryKvStore();
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    const a = await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv });
    const b = await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv });
    expect(a).toMatchObject({ kind: 'ok', cache: 'miss', version: 3 });
    expect(b).toMatchObject({ kind: 'ok', cache: 'hit', version: 3 });
    expect(db.calls.row).toBe(1); // el grafo pesado solo se leyo una vez
    expect(db.calls.meta).toBe(2); // la consulta ligera (autorizacion) SIEMPRE
    expect((b as any).graph.concepts).toHaveLength(2);
  });
  it('AUTORIZACION PRIMERO: sin fila visible no se toca el cache ni se lee el grafo', async () => {
    const kv = new MemoryKvStore();
    const get = vi.spyOn(kv, 'get');
    const set = vi.spyOn(kv, 'set');
    // Alguien mas ya dejo la clase en cache...
    await getCachedClassGraph({ classroomId: CLASS_A, ...memoryDb({ status: 'ready', version: 3, graph: graphV(2) }), kv });
    get.mockClear();
    set.mockClear();
    // ... pero para este usuario la politica no devuelve fila.
    const denied = memoryDb(null);
    expect(await getCachedClassGraph({ classroomId: CLASS_A, ...denied, kv })).toEqual({ kind: 'none' });
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(denied.calls.row).toBe(0);
  });
  it('building y failed no tocan el cache', async () => {
    const kv = new MemoryKvStore();
    const get = vi.spyOn(kv, 'get');
    for (const [status, kind] of [['building', 'building'], ['failed', 'failed'], ['rara', 'failed']] as const) {
      const db = memoryDb({ status, version: 1, graph: graphV(1) });
      expect(await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv })).toEqual({ kind });
      expect(db.calls.row).toBe(0);
    }
    expect(get).not.toHaveBeenCalled();
    expect(kv.size).toBe(0);
  });
  it('al subir la version la copia vieja deja de servirse (invalidacion instantanea)', async () => {
    const kv = new MemoryKvStore();
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv });
    db.state.row = { status: 'ready', version: 4, graph: graphV(5) };
    const r = await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv });
    expect(r).toMatchObject({ kind: 'ok', cache: 'miss', version: 4 });
    expect((r as any).graph.concepts).toHaveLength(5);
    expect(db.calls.row).toBe(2);
  });
  it('si la reconstruccion termina ENTRE las dos consultas, se guarda bajo la version realmente leida', async () => {
    const kv = new MemoryKvStore();
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    const loadRow = async (): Promise<MemoryRow> => ({ status: 'ready', version: 4, graph: graphV(5) }); // el meta dijo 3
    const r = await getCachedClassGraph({ classroomId: CLASS_A, loadMeta: db.loadMeta, loadRow, kv });
    expect(r).toMatchObject({ kind: 'ok', version: 4 });
    // Quien pregunte por v3 NO recibe el grafo de v4 envenenando esa clave.
    const again = await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv });
    expect(again).toMatchObject({ cache: 'miss', version: 3 });
    expect((again as any).graph.concepts).toHaveLength(2);
  });
  it('si la fila leida ya no esta lista (empezo otra reconstruccion) no se cachea', async () => {
    const kv = new MemoryKvStore();
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    const loadRow = async (): Promise<MemoryRow> => ({ status: 'building', version: 3, graph: graphV(2) });
    expect(await getCachedClassGraph({ classroomId: CLASS_A, loadMeta: db.loadMeta, loadRow, kv })).toEqual({ kind: 'building' });
    expect(kv.size).toBe(0);
  });
  it('si la fila desaparece entre las dos consultas, none', async () => {
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    expect(await getCachedClassGraph({ classroomId: CLASS_A, loadMeta: db.loadMeta, loadRow: async () => null, kv: new MemoryKvStore() })).toEqual({ kind: 'none' });
  });
  it('dos clases no comparten cache aunque tengan la misma version', async () => {
    const kv = new MemoryKvStore();
    await getCachedClassGraph({ classroomId: CLASS_A, ...memoryDb({ status: 'ready', version: 1, graph: graphV(2) }), kv });
    const dbB = memoryDb({ status: 'ready', version: 1, graph: graphV(7) });
    const r = await getCachedClassGraph({ classroomId: CLASS_B, ...dbB, kv });
    expect(r).toMatchObject({ cache: 'miss' });
    expect((r as any).graph.concepts).toHaveLength(7);
    expect(kv.size).toBe(2);
  });
  it('lo corrupto en el cache (campos limpiados por readGraph) se borra y se recalcula', async () => {
    const kv = new MemoryKvStore();
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    await kv.set(buildKvKey('mem', 'graph', CLASS_A, 'v3'), { concepts: [{ nombre: 'sin key ni name' }, concept('ok')], edges: [] }, 60);
    const r = await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv });
    expect(r).toMatchObject({ kind: 'ok', cache: 'miss' });
    expect((r as any).graph.concepts).toHaveLength(2); // el de la base, no el corrupto
    expect(db.calls.row).toBe(1);
  });
  it('lo que sale del cache tambien se limpia con readGraph (campos fuera de rango se corrigen, no se confia)', async () => {
    const kv = new MemoryKvStore();
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    // Mismo numero de conceptos, pero con una importancia imposible: readGraph la deja en 5.
    await kv.set(buildKvKey('mem', 'graph', CLASS_A, 'v3'), { concepts: [{ ...concept('a'), importance: 99 }], edges: [] }, 60);
    const r = await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv });
    expect(r).toMatchObject({ kind: 'ok', cache: 'hit' });
    expect((r as any).graph.concepts[0].importance).toBe(5);
    expect(db.calls.row).toBe(0);
  });
  it('lo que no tiene forma de grafo en el cache se descarta', async () => {
    const kv = new MemoryKvStore();
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    await kv.set(buildKvKey('mem', 'graph', CLASS_A, 'v3'), 'cualquier cosa', 60);
    expect(await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv })).toMatchObject({ cache: 'miss' });
    expect(db.calls.row).toBe(1);
  });
  it('un arista con extremos inexistentes en el cache tambien cuenta como corrupto', async () => {
    const kv = new MemoryKvStore();
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    await kv.set(buildKvKey('mem', 'graph', CLASS_A, 'v3'), { concepts: [concept('a')], edges: [{ from: 'a', to: 'fantasma', relation: 'causa' }] }, 60);
    expect(await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv })).toMatchObject({ cache: 'miss' });
  });
  it('sin cache (kv: null), un id raro o una version rara: bypass, siempre con la base', async () => {
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    expect(await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv: null })).toMatchObject({ kind: 'ok', cache: 'bypass' });
    const kv = new MemoryKvStore();
    expect(await getCachedClassGraph({ classroomId: 'id:raro*', ...db, kv })).toMatchObject({ kind: 'ok', cache: 'bypass' });
    const weird = memoryDb({ status: 'ready', version: -1, graph: graphV(1) });
    expect(await getCachedClassGraph({ classroomId: CLASS_A, ...weird, kv })).toMatchObject({ kind: 'ok', cache: 'bypass' });
    expect(kv.size).toBe(0);
  });
  it('guarda con el TTL de una hora', async () => {
    const kv = new MemoryKvStore();
    const spy = vi.spyOn(kv, 'set');
    await getCachedClassGraph({ classroomId: CLASS_A, ...memoryDb({ status: 'ready', version: 3, graph: graphV(1) }), kv });
    expect(GRAPH_CACHE_TTL_SECONDS).toBe(3600);
    expect(spy.mock.calls[0][2]).toBe(3600);
    expect(spy.mock.calls[0][0]).toBe(`mem:graph:${CLASS_A}:v3`);
  });
  it('a la hora el cache vence y se vuelve a leer la base', async () => {
    const c = clock();
    const kv = new MemoryKvStore({ now: c.now });
    const db = memoryDb({ status: 'ready', version: 3, graph: graphV(2) });
    await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv });
    c.advance(3601);
    expect(await getCachedClassGraph({ classroomId: CLASS_A, ...db, kv })).toMatchObject({ cache: 'miss' });
  });
  it('lo que se guarda y devuelve es el grafo YA limpiado por readGraph', async () => {
    const kv = new MemoryKvStore();
    const dirty = { concepts: [{ ...concept('a'), name: 'N'.repeat(5000), importance: 99 }, 'basura', { ...concept('a') }], edges: [] };
    const r = await getCachedClassGraph({ classroomId: CLASS_A, ...memoryDb({ status: 'ready', version: 1, graph: dirty }), kv });
    const g = (r as any).graph;
    expect(g.concepts).toHaveLength(1); // basura y duplicado fuera
    expect(g.concepts[0].importance).toBe(5);
    expect(g.concepts[0].name.length).toBeLessThan(5000);
  });
});
