// Comprueba que los medios de Toñito estan bien servidos desde el proveedor elegido (Supabase Storage o Cloudflare R2).
//
// Mira, por cada archivo: que responda 200, su tipo, su peso frente al tope, que admita rangos (para que el video avance y se
// reanude) y que traiga una cache larga (los archivos son inmutables). Solo lee: hace HEAD y una peticion de 2 bytes.
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
  process.exit(0);
}

const kindOf = (rel: string): MediaKind => (rel.endsWith('.mp4') ? 'video' : 'poster');
const targets: { rel: string; kind: MediaKind }[] = probes.length
  ? probes.map((rel) => ({ rel, kind: kindOf(rel) }))
  : Object.values(TONITO_CLIPS).flatMap((c) => [{ rel: c.src, kind: 'video' as const }, { rel: c.poster, kind: 'poster' as const }]);

if (targets.length === 0) {
  console.log('No hay clips registrados en TONITO_CLIPS. Usa --probe <ruta> para comprobar un archivo suelto.');
  process.exit(0);
}

const lower = (h: Headers) => Object.fromEntries(Array.from(h.entries()).map(([k, v]) => [k.toLowerCase(), v]));

async function check(rel: string, kind: MediaKind): Promise<boolean> {
  const url = mediaUrl(rel, base);
  console.log(`\n${url}`);
  let head: Response;
  try {
    head = await fetch(url, { method: 'HEAD', redirect: 'manual' });
  } catch (e) {
    console.log(`  ✘ no se pudo conectar: ${e instanceof Error ? e.message : e}`);
    return false;
  }
  const headers = lower(head.headers);
  const v = judgeMediaResponse(kind, head.status, headers);
  console.log(`  HTTP ${head.status} | ${headers['content-type'] ?? '?'} | ${headers['content-length'] ? (Number(headers['content-length']) / 1024).toFixed(0) + ' KB' : '? KB'} | cache-control: ${headers['cache-control'] ?? '(ninguno)'}`);
  // Prueba real de rangos (mas fiable que leer la cabecera): pedir 2 bytes debe dar 206.
  if (kind === 'video' && head.status === 200) {
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-1' }, redirect: 'manual' });
      if (r.status !== 206) v.warnings.push(`una peticion con Range respondio ${r.status} en vez de 206`);
      await r.arrayBuffer();
    } catch {
      v.warnings.push('no se pudo probar la peticion con Range');
    }
  }
  for (const e of v.errors) console.log(`  ✘ ${e}`);
  for (const w of v.warnings) console.log(`  ! ${w}`);
  if (v.ok && v.warnings.length === 0) console.log('  ✔ bien servido');
  else if (v.ok) console.log('  ✔ funciona (con avisos)');
  return v.ok;
}

(async () => {
  console.log(`Base: ${base}`);
  let allOk = true;
  for (const t of targets) allOk = (await check(t.rel, t.kind)) && allOk;
  console.log(allOk ? '\nTodo en orden.' : '\nHay archivos con errores.');
  process.exit(allOk ? 0 : 1);
})();
