// PRUEBA DE HUMO de la capa clave-valor contra el Upstash REAL.
//
// Los tests del repo simulan las respuestas de Redis; este script comprueba lo que ellos no pueden: que tu URL y tu token funcionan y que los comandos que usa la capa (SET con EX,
// GET, DEL, MULTI con INCR + EXPIRE NX + TTL) responden como se espera. Como la capa degrada EN SILENCIO ante cualquier falla, cada paso verifica ademas que la operacion la atendio
// Redis y no el respaldo en memoria.
//
// Uso:  npm run kv:smoke      (lee UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN de .env.local)
// Nunca imprime el token ni valores guardados. Escribe SOLO claves `quota:smoke-<hora>-*` con TTL corto y las borra al terminar.

import { MemoryKvStore, UpstashHttpKvStore, buildKvKey, createKvFromEnv, type KeyValueStore } from '../src/lib/kv';

const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${name}${detail ? ' - ' + detail : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!url || !token) {
  console.log('Faltan UPSTASH_REDIS_REST_URL y/o UPSTASH_REDIS_REST_TOKEN en .env.local. Nada que probar.');
  process.exit(2);
}
let host = '?';
try {
  host = new URL(url).host;
} catch {
  // se informa abajo
}
console.log(`URL: ${host} | token: ${token ? 'definido (' + token.length + ' caracteres)' : 'NO'}`);
check('la URL es https', /^https:\/\//i.test(url));

// fetch instrumentado: cuenta respuestas buenas y malas sin mostrar nada sensible.
const stats = { ok: 0, bad: 0, errors: 0, latencies: [] as number[], statuses: new Set<number>() };
const countingFetch: typeof fetch = async (input, init) => {
  const t0 = Date.now();
  try {
    const res = await fetch(input, init);
    stats.latencies.push(Date.now() - t0);
    stats.statuses.add(res.status);
    if (res.ok) stats.ok++;
    else stats.bad++;
    return res;
  } catch (e) {
    stats.errors++;
    throw e;
  }
};
const reset = () => {
  stats.ok = stats.bad = stats.errors = 0;
  stats.latencies = [];
};

const run = Date.now().toString(36);
const key = (n: string) => buildKvKey('quota', `smoke-${run}-${n}`);
const isNum = (v: unknown): v is number => typeof v === 'number';
const isObj = (v: unknown): v is { a: number; s: string } => !!v && typeof v === 'object' && typeof (v as any).a === 'number';

function makeStore(tok: string) {
  const fallback = new MemoryKvStore();
  return { fallback, store: new UpstashHttpKvStore({ url: url!, token: tok, fallback, fetchImpl: countingFetch }) };
}

async function main() {
  const { store, fallback } = makeStore(token!);
  const usedKeys: ReturnType<typeof key>[] = [];

  // 1. conexion y autenticacion
  reset();
  await store.set(key('ping'), 1, 30);
  usedKeys.push(key('ping'));
  check('SET llega a Redis (HTTP 2xx, sin pasar por el respaldo)', stats.ok === 1 && stats.bad === 0 && stats.errors === 0 && fallback.size === 0, `respuestas buenas=${stats.ok} malas=${stats.bad} errores=${stats.errors} estados=${Array.from(stats.statuses).join(',')}`);
  if (stats.ok === 0) {
    console.log('\nRedis no respondio bien: la capa estaria degradando al respaldo en memoria. Revisa la URL y el token (¿copiaste el token completo? ¿es el de ESTA base?).');
  }

  // 2. ida y vuelta con un objeto
  reset();
  await store.set(key('obj'), { a: 7, s: 'ñ✓' }, 30);
  usedKeys.push(key('obj'));
  const back = await store.get(key('obj'), isObj);
  check('GET devuelve lo que SET guardo (objeto con acentos)', back?.a === 7 && back?.s === 'ñ✓' && fallback.size === 0, `respuestas buenas=${stats.ok}`);

  // 3. vencimiento real (EX)
  await store.set(key('ttl'), 5, 2);
  usedKeys.push(key('ttl'));
  check('antes de vencer, el valor esta', (await store.get(key('ttl'), isNum)) === 5);
  await sleep(3200);
  check('despues del TTL (2 s) Redis ya no lo devuelve', (await store.get(key('ttl'), isNum)) === null && fallback.size === 0);

  // 4. validador: un valor con otra forma se borra
  await store.set(key('shape'), 'texto', 30);
  usedKeys.push(key('shape'));
  check('un valor que no pasa el validador da null', (await store.get(key('shape'), isNum)) === null);
  check('... y quedo borrado en Redis (un validador permisivo ya no lo ve)', (await store.get(key('shape'), (v): v is unknown => true)) === null);

  // 5. del
  await store.set(key('del'), 1, 30);
  await store.del(key('del'));
  check('DEL borra', (await store.get(key('del'), isNum)) === null && fallback.size === 0);

  // 6. contador de ventana (MULTI: INCR + EXPIRE NX + TTL)
  reset();
  const c1 = await store.incrWithWindow(key('win'), 3);
  const c2 = await store.incrWithWindow(key('win'), 3);
  const c3 = await store.incrWithWindow(key('win'), 3);
  usedKeys.push(key('win'));
  check('contador: 1, 2, 3 atendido por Redis', c1.count === 1 && c2.count === 2 && c3.count === 3 && fallback.size === 0 && stats.bad === 0 && stats.errors === 0, `conteos=${c1.count},${c2.count},${c3.count} estados=${Array.from(stats.statuses).join(',')}`);
  check('contador: el TTL de la ventana es valido (1..3 s)', c1.ttlSeconds >= 1 && c1.ttlSeconds <= 3 && c3.ttlSeconds >= 1 && c3.ttlSeconds <= 3, `ttl=${c1.ttlSeconds},${c3.ttlSeconds}`);
  await sleep(3500);
  const c4 = await store.incrWithWindow(key('win'), 3);
  check('contador: al vencer la ventana vuelve a 1 (EXPIRE NX no dejo una clave eterna)', c4.count === 1, `conteo=${c4.count}`);

  // 7. latencia contra el limite de tiempo de la capa (800 ms)
  reset();
  for (let i = 0; i < 6; i++) await store.get(key('obj'), isObj);
  const lat = [...stats.latencies].sort((a, b) => a - b);
  const p50 = lat[Math.floor(lat.length / 2)] ?? 0;
  const max = lat[lat.length - 1] ?? 0;
  check('latencia desde esta maquina bajo el limite de 800 ms', max < 800, `mediana=${p50} ms, maxima=${max} ms (Vercel suele estar mas cerca de la base que tu casa; tu base esta en Sao Paulo)`);

  // 8. el camino REAL de la app: createKvFromEnv (L1 + L2) escribe de verdad en Redis
  const app: KeyValueStore = createKvFromEnv({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token }, countingFetch);
  await app.set(key('app'), { a: 1, s: 'x' }, 30);
  usedKeys.push(key('app'));
  const probe = makeStore(token!); // otra "instancia": sin L1, sin respaldo con datos
  check('createKvFromEnv escribe en Redis (otra instancia lo lee)', (await probe.store.get(key('app'), isObj))?.a === 1 && probe.fallback.size === 0);

  // 9. token falso: degrada sin lanzar y abre el cortacircuito
  const bad = makeStore('token-falso');
  reset();
  let threw = false;
  try {
    await bad.store.set(key('bad'), 1, 30);
    await bad.store.get(key('bad'), isNum);
    await bad.store.incrWithWindow(key('badwin'), 30);
  } catch {
    threw = true;
  }
  check('con un token falso no lanza y sigue respondiendo desde el respaldo', !threw && (await bad.store.get(key('bad'), isNum)) === 1, `respuestas malas=${stats.bad} estados=${Array.from(stats.statuses).join(',')}`);
  check('con un token falso el cortacircuito se abre tras 3 fallas', bad.store.circuitOpen, `peticiones hechas=${stats.bad + stats.ok + stats.errors}`);

  // limpieza
  for (const k of usedKeys) await store.del(k);
  console.log(`\nTermino: ${failures === 0 ? 'TODO BIEN' : failures + ' comprobacion(es) FALLARON'}.`);
}

main()
  .catch((e) => {
    console.log('Error inesperado:', e instanceof Error ? e.message : 'desconocido');
    failures++;
  })
  .finally(() => process.exit(failures === 0 ? 0 : 1));
