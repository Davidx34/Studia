// Convierte un video en bruto (por ejemplo de Flow) en un clip de cinematica de Toñito y, con --publish, lo deja funcionando en la app
// sin tocar codigo ni redesplegar. Flujo completo: docs/TONITO_CINEMATICAS.md.
//
//   npm run clip:publish -- --video ./mi-video.mp4 --scene welcome        (convierte, sube, comprueba y publica)
//   npm run clip:prepare -- --video ./mi-video.mp4 --id mi-clip            (solo convierte: deja los archivos en ./clips-out/)
//
// Opciones: --scene <escena> (con --publish), --id <nombre> (por defecto, el de la escena), --poster-at <segundos>, --loop.
//
// Necesita ffmpeg: en el PATH, o la ruta en la variable FFMPEG_PATH. (Windows: `winget install Gyan.FFmpeg`.)
// Para publicar necesita .env.local con SUPABASE_SERVICE_ROLE_KEY (nunca se imprime) y la migracion 073 aplicada.
//
// Los archivos son inmutables: si el id ya tiene archivos, se usa la version siguiente (.v2). Los viejos no se tocan.

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import {
  ENCODE_LADDER, POSTER_QUALITIES, clipPaths, durationWarning, fitsPoster, fitsVideo, nextVersion, parseVideoInfo, posterArgs,
  validClipId, videoArgs,
} from '../src/lib/tonito/clipPipeline';
import { TONITO_CLIPS } from '../src/lib/tonito/clips';
import { CINEMATIC_TYPES, isCinematicType } from '../src/lib/tonito/scenes';
import { judgeMediaResponse, mediaUrl, TONITO_BUCKET, type MediaKind } from '../src/lib/tonito/media';
import { supabasePublicBase } from '../src/lib/tonito/mediaUpload';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const publish = has('--publish');

function fail(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

function run(cmd: string, a: string[]) {
  return spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

async function main() {
  const input = val('--video');
  const scene = val('--scene');
  if (!input || (!publish && !val('--id')) || (publish && !scene)) {
    console.log(
      publish
        ? `Uso: npm run clip:publish -- --video <archivo> --scene <escena> [--id <nombre>] [--poster-at 1.5] [--loop]\nEscenas: ${CINEMATIC_TYPES.join(', ')}`
        : 'Uso: npm run clip:prepare -- --video <archivo> --id <nombre-en-minusculas> [--poster-at 1.5] [--loop]',
    );
    process.exit(1);
  }
  if (scene && !isCinematicType(scene)) fail(`la escena "${scene}" no existe. Escenas: ${CINEMATIC_TYPES.join(', ')}`);
  const id = val('--id') ?? scene!.replace(/_/g, '-');
  if (!validClipId(id)) fail(`el id "${id}" no vale: minusculas, numeros y guiones sueltos (por ejemplo "exito-total")`);
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) fail(`no existe el video: ${input}`);

  // Para publicar hace falta hablar con Supabase ANTES de convertir: asi un problema de claves o de migracion cuesta segundos.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const redact = (s: string) => (key ? s.split(key).join('[CLAVE]') : s);
  let supabase: ReturnType<typeof createClient> | undefined;
  const used = Object.values(TONITO_CLIPS).flatMap((c) => [c.src, c.poster]);
  if (publish) {
    if (!url || !key) fail('faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
    supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const rows = await supabase.from('tonito_scene_clips').select('src, poster');
    if (rows.error) fail(`no se pudo leer tonito_scene_clips: ${redact(rows.error.message)}. ¿Ya se aplico la migracion 073?`);
    for (const r of rows.data ?? []) used.push((r as any).src, (r as any).poster);
    const files = await supabase.storage.from(TONITO_BUCKET).list('clips', { limit: 500 });
    if (files.error) fail(`no se pudo listar el bucket: ${redact(files.error.message)}`);
    for (const f of files.data ?? []) used.push(`clips/${f.name}`);
  }

  const probe = run(ffmpeg, ['-hide_banner', '-i', input]);
  if (probe.error) fail(`no se pudo ejecutar ffmpeg (${ffmpeg}). Instalalo o pon su ruta en FFMPEG_PATH. Windows: winget install Gyan.FFmpeg`);
  const info = parseVideoInfo(`${probe.stderr}`);
  if (!info) fail('ffmpeg no reconoce ese archivo como video');
  const warn = durationWarning(info.seconds);
  console.log(`Original: ${info.width}x${info.height}, ${info.seconds.toFixed(1)} s, ${kb(fs.statSync(input).size)}`);
  if (warn) console.log(`! ${warn}`);

  const version = nextVersion(id, used);
  if (version > 1) console.log(`! el id "${id}" ya tiene archivos: se prepara la version v${version} (los archivos son inmutables)`);
  const paths = clipPaths(id, version);

  const outDir = path.resolve('clips-out');
  fs.mkdirSync(outDir, { recursive: true });
  const videoOut = path.join(outDir, path.basename(paths.video));
  const posterOut = path.join(outDir, path.basename(paths.poster));

  // 1) Video: la primera calidad de la escalera que entra en el peso maximo.
  let chosen: { maxWidth: number; crf: number } | null = null;
  for (const step of ENCODE_LADDER) {
    const r = run(ffmpeg, videoArgs(input, videoOut, step));
    if (r.status !== 0) fail(`ffmpeg fallo al convertir el video:\n${`${r.stderr}`.split('\n').slice(-6).join('\n')}`);
    const size = fs.statSync(videoOut).size;
    console.log(`  prueba ancho<=${step.maxWidth} crf ${step.crf}: ${kb(size)}`);
    if (fitsVideo(size)) {
      chosen = step;
      break;
    }
  }
  if (!chosen) fail('ninguna calidad entra en 400 KB. Acorta el video o simplificalo (menos movimiento de fondo) y vuelve a probar.');

  // 2) Poster: un cuadro representativo, con la mejor calidad que entre en 60 KB.
  const posterAt = Number(val('--poster-at') ?? Math.min(1.5, info.seconds / 2));
  let posterOk = false;
  for (const q of POSTER_QUALITIES) {
    const r = run(ffmpeg, posterArgs(videoOut, posterOut, posterAt, q));
    if (r.status !== 0) fail('ffmpeg fallo al sacar el poster');
    if (fitsPoster(fs.statSync(posterOut).size)) {
      posterOk = true;
      break;
    }
  }
  if (!posterOk) fail('el poster no entra en 60 KB ni con la calidad mas baja');

  const out = parseVideoInfo(`${run(ffmpeg, ['-hide_banner', '-i', videoOut]).stderr}`)!;
  console.log(`\n✔ ${path.relative(process.cwd(), videoOut)}  ${out.width}x${out.height}  ${out.seconds.toFixed(1)} s  ${kb(fs.statSync(videoOut).size)}`);
  console.log(`✔ ${path.relative(process.cwd(), posterOut)}  ${kb(fs.statSync(posterOut).size)}`);
  console.log('  Revisa el poster y el video antes de publicar: el script comprueba las reglas tecnicas, no si se ve bien.');

  if (!publish) {
    console.log(`\nSolo se convirtio. Para publicarlo en una escena: npm run clip:publish -- --video ${input} --scene <escena> --id ${id}`);
    return;
  }

  // 3) Subir los dos archivos (sin sobrescribir).
  console.log('\nSubiendo…');
  const up = spawnSync(
    'npx',
    ['tsx', '--env-file=.env.local', 'scripts/media-upload.ts', '--file', videoOut, '--path', paths.video, '--file', posterOut, '--path', paths.poster],
    { stdio: 'inherit', shell: true },
  );
  if (up.status !== 0) fail('la subida fallo; no se publico nada');

  // 4) Comprobar que se sirven bien DESDE el bucket, antes de apuntar la escena a ellos.
  const base = supabasePublicBase(url!);
  const checks: [MediaKind, string][] = [['video', paths.video], ['poster', paths.poster]];
  for (const [kind, rel] of checks) {
    const res = await fetch(mediaUrl(rel, base), { headers: { Range: 'bytes=0-1' } });
    const verdict = judgeMediaResponse(kind, res.status, Object.fromEntries(res.headers.entries()));
    for (const e of verdict.errors) console.log(`  ✘ ${rel}: ${e}`);
    for (const w of verdict.warnings) console.log(`  ! ${rel}: ${w}`);
    if (!verdict.ok) fail('el bucket no sirve bien el archivo; no se publico la escena (los archivos subidos quedan sin usar)');
    console.log(`  ✔ ${rel} se sirve bien`);
  }

  // 5) Publicar: apuntar la escena al clip nuevo. Desde aqui la app lo usa (en pocos minutos, por la cache).
  const { error } = await (supabase as any).from('tonito_scene_clips').upsert(
    { scene, clip_id: id, src: paths.video, poster: paths.poster, width: out.width, height: out.height, loop: has('--loop'), active: true, updated_at: new Date().toISOString() },
    { onConflict: 'scene' },
  );
  if (error) fail(`no se pudo publicar la escena: ${redact(error.message)}`);
  console.log(`\n✔ Publicado: la escena "${scene}" usa ahora "${id}" (v${version}). Los estudiantes lo ven en pocos minutos, sin redesplegar.`);
  console.log('  Para apagarlo:  npm run clip:off -- --scene ' + scene);
  console.log('  Para verlo:     /dev/cinematicas');
}

main().catch((e) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
