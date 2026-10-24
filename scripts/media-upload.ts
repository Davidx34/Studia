// Sube (o lista) los medios de Toñito en el bucket PUBLICO `tonito-media` de Supabase Storage.
//
// Escribe con la clave de servicio (SUPABASE_SERVICE_ROLE_KEY de .env.local): es la unica via de escritura, el bucket no tiene
// politicas para anon ni authenticated (migracion 072). La clave NUNCA se imprime.
//
// Los archivos son INMUTABLES: no se sobrescriben (upsert: false) y llevan la version en el nombre. Se suben con cache de un año.
//
// Uso (en TU maquina, con TU .env.local):
//   npm run media:upload -- --file ./celebracion.mp4 --path clips/celebracion.v1.mp4
//   npm run media:upload -- --file ./a.mp4 --path clips/a.v1.mp4 --file ./a.jpg --path clips/a.v1.jpg      (varios a la vez)
//   npm run media:upload -- --file ./a.mp4 --path clips/a.v1.mp4 --dry-run     (solo valida, no sube)
//   npm run media:upload -- --list                                              (lo que hay en el bucket)
//
// Despues de subir: npm run media:check -- --base <la base que imprime> --probe <ruta>

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { CACHE_CONTROL_SECONDS, TONITO_BUCKET, planUpload, supabasePublicBase } from '../src/lib/tonito/mediaUpload';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const all = (f: string) => args.flatMap((a, i) => (a === f ? [args[i + 1]] : []));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function usage(): never {
  console.log(`Uso:
  npm run media:upload -- --file <archivo local> --path clips/<nombre>.v<N>.mp4|jpg|webp [--dry-run]
  npm run media:upload -- --list`);
  process.exit(1);
}

const redact = (s: string) => (key ? s.split(key).join('[CLAVE]') : s);

async function main() {
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const base = supabasePublicBase(url);

  if (has('--list')) {
    for (const folder of ['', 'clips']) {
      const { data, error } = await supabase.storage.from(TONITO_BUCKET).list(folder, { limit: 200, sortBy: { column: 'name', order: 'asc' } });
      if (error) {
        console.error(`No se pudo listar "${folder || '/'}": ${redact(error.message)}${/not found/i.test(error.message) ? ' (¿ya se aplico la migracion 072?)' : ''}`);
        process.exit(1);
      }
      for (const o of data ?? []) {
        if (o.id === null) console.log(`  ${folder ? folder + '/' : ''}${o.name}/   (carpeta)`);
        else console.log(`  ${folder ? folder + '/' : ''}${o.name}   ${((Number((o.metadata as any)?.size) || 0) / 1024).toFixed(0)} KB`);
      }
    }
    console.log(`\nBase publica: ${base}`);
    return;
  }

  const files = all('--file');
  const paths = all('--path');
  if (files.length === 0 || files.length !== paths.length) usage();

  // 1) Validar TODO antes de subir nada: si un archivo falla, no se sube ninguno.
  const jobs: { file: string; rel: string; bytes: Buffer; contentType: string }[] = [];
  let bad = false;
  for (let i = 0; i < files.length; i++) {
    const [file, rel] = [files[i], paths[i]];
    console.log(`\n${file}  ->  ${rel}`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      console.log('  ✘ el archivo local no existe');
      bad = true;
      continue;
    }
    const bytes = fs.readFileSync(file);
    const plan = planUpload(rel, bytes);
    for (const e of plan.errors) console.log(`  ✘ ${e}`);
    for (const w of plan.warnings) console.log(`  ! ${w}`);
    if (plan.ok) {
      console.log(`  ✔ valido: ${plan.kind}, ${plan.contentType}, ${(bytes.length / 1024).toFixed(0)} KB`);
      jobs.push({ file, rel, bytes, contentType: plan.contentType! });
    } else bad = true;
  }
  if (bad) {
    console.log('\nNo se subio nada: hay archivos con errores.');
    process.exit(1);
  }
  if (has('--dry-run')) {
    console.log('\n--dry-run: todo valido, no se subio nada.');
    return;
  }

  // 2) Subir, sin sobrescribir.
  let failed = false;
  for (const j of jobs) {
    const { error } = await supabase.storage.from(TONITO_BUCKET).upload(j.rel, j.bytes, { contentType: j.contentType, cacheControl: CACHE_CONTROL_SECONDS, upsert: false });
    if (error) {
      const msg = redact(error.message);
      const hint = /already exists|duplicate/i.test(msg)
        ? ' -> los archivos son inmutables: sube una version nueva (.v2), no se sobrescribe'
        : /not found/i.test(msg)
          ? ' -> ¿ya se aplico la migracion 072 que crea el bucket?'
          : '';
      console.log(`  ✘ ${j.rel}: ${msg}${hint}`);
      failed = true;
    } else {
      console.log(`  ✔ subido: ${base}/${j.rel}`);
    }
  }
  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log(`\nValor para Vercel: NEXT_PUBLIC_TONITO_MEDIA_BASE_URL=${base}`);
  console.log(`Comprobar: npm run media:check -- --base ${base} --probe ${jobs[0].rel}`);
}

main().catch((e) => {
  console.error('FALLO:', redact(e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
});
