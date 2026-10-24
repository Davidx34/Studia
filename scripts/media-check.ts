// Comprueba que los medios de Toñito estan bien servidos desde el proveedor elegido (Supabase Storage o Cloudflare R2).
//
// Por archivo hace UNA peticion GET pidiendo solo 2 bytes (Range) y mira: que responda 206 (prueba de que admite rangos, necesario
// para que el video avance y se reanude), su tipo, su peso total frente al tope y su Cache-Control (los archivos son inmutables).
//
// IMPORTANTE: se usa GET y no HEAD a proposito. Con Supabase (y Cloudflare en general) un HEAD NO pasa por la cache del CDN y devuelve
// "Cache-Control: private, no-cache" aunque el archivo se sirva con "public, max-age=31536000" por GET. Juzgar con HEAD da falsos
// negativos (medido con el bucket real, 2026-10-24).
//
// Uso (en TU maquina, con TU .env.local):
//   npm run media:check                                   los clips registrados en src/lib/tonito/clips.ts
//   npm run media:check -- --probe clips/prueba.v1.mp4    un archivo cualquiera (sirve ANTES de registrarlo)
//   npm run media:check -- --base https://media.ejemplo.com --probe clips/prueba.v1.mp4
//
// La base sale de NEXT_PUBLIC_TONITO_MEDIA_BASE_URL (o de --base). Sale con codigo 1 si algo falla.

import { TONITO_CLIPS } from '../src/lib/tonito/clips';
import { LOCAL_MEDIA_BASE, judgeMediaResponse, mediaUrl, resolveMediaBase, type MediaKind } from '../src/lib/tonito/media';

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const probes = args.flatMap((a, i) => (a === '--probe' ? [args[i + 1]] : []));

const rawBase = flag('--base') ?? process.env.NEXT_PUBLIC_TONITO_MEDIA_BASE_URL;
const base = resolveMediaBase(rawBase);
if (rawBase && base === LOCAL_MEDIA_BASE) {
  console.error(`La base "${rawBase}" no es valida (debe ser https, sin credenciales, parametros ni fragmento). Se ignora.`);
}
if (base === LOCAL_MEDIA_BASE) {
  console.log('La base es LOCAL (/tonito): los archivos viven en public/ del repo y los vigila `npm test`, no hay nada remoto que comprobar.');
  console.log('Para probar un proveedor, pon NEXT_PUBLIC_TONITO_MEDIA_BASE_URL en .env.local o pasa --base <url>.');
  process.exitCode = 0;
}

const kindOf = (rel: string): MediaKind => (rel.endsWith('.mp4') ? 'video' : 'poster');
const lower = (h: Headers) => Object.fromEntries(Array.from(h.entries()).map(([k, v]) => [k.toLowerCase(), v]));

async function check(rel: string, kind: MediaKind): Promise<boolean> {
  const url = mediaUrl(rel, base);
  console.log(`\n${url}`);
  let res: Response;
  try {
    res = await fetch(url, { headers: { Range: 'bytes=0-1' }, redirect: 'manual' });
    await res.arrayBuffer(); // se consume el cuerpo (2 bytes, o el archivo entero si el servidor ignora Range)
  } catch (e) {
    console.log(`  ✘ no se pudo conectar: ${e instanceof Error ? e.message : e}`);
    return false;
  }
  const headers = lower(res.headers);
  const v = judgeMediaResponse(kind, res.status, headers);
  const total = /\/(\d+)\s*$/.exec(headers['content-range'] ?? '')?.[1] ?? headers['content-length'];
  const cdn = headers['cf-cache-status'] ? ` | CDN: ${headers['cf-cache-status']}` : '';
  console.log(`  HTTP ${res.status} | ${headers['content-type'] ?? '?'} | ${total ? (Number(total) / 1024).toFixed(0) + ' KB' : '? KB'} | cache-control: ${headers['cache-control'] ?? '(ninguno)'}${cdn}`);
  for (const e of v.errors) console.log(`  ✘ ${e}`);
  for (const w of v.warnings) console.log(`  ! ${w}`);
  if (v.ok && v.warnings.length === 0) console.log('  ✔ bien servido');
  else if (v.ok) console.log('  ✔ funciona (con avisos)');
  return v.ok;
}

async function main() {
  const targets: { rel: string; kind: MediaKind }[] = probes.length
    ? probes.map((rel) => ({ rel, kind: kindOf(rel) }))
    : Object.values(TONITO_CLIPS).flatMap((c) => [{ rel: c.src, kind: 'video' as const }, { rel: c.poster, kind: 'poster' as const }]);
  if (targets.length === 0) {
    console.log('No hay clips registrados en TONITO_CLIPS. Usa --probe <ruta> para comprobar un archivo suelto.');
    return;
  }
  console.log(`Base: ${base}`);
  let allOk = true;
  for (const t of targets) allOk = (await check(t.rel, t.kind)) && allOk;
  console.log(allOk ? '\nTodo en orden.' : '\nHay archivos con errores.');
  // exitCode y no process.exit: en Windows, salir de golpe con conexiones abiertas provoca un aviso de Node.
  process.exitCode = allOk ? 0 : 1;
}

// Al final: las funciones de arriba tienen que estar inicializadas antes de arrancar.
if (base !== LOCAL_MEDIA_BASE) void main();
