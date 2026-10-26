// Convierte un video en bruto (por ejemplo de Flow) en un clip listo para las cinematicas de Toñito: MP4 H.264 sin audio dentro del
// peso maximo, mas su poster. Opcionalmente lo sube al bucket. Flujo completo: docs/TONITO_CINEMATICAS.md.
//
// Necesita ffmpeg: en el PATH, o la ruta en la variable FFMPEG_PATH. (Windows: `winget install Gyan.FFmpeg`.)
//
// Uso:
//   npm run clip:prepare -- --video ./mi-video.mp4 --id exito-total [--scene streak] [--poster-at 1.5] [--loop] [--upload]
//
// Sin --upload deja los archivos en ./clips-out/ (ignorada por git) y no toca nada mas. Con --upload los sube con media:upload y
// comprueba la subida con media:check. Nunca sobrescribe: si el id ya existe en el registro, usa la version siguiente (.v2).

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  ENCODE_LADDER, POSTER_QUALITIES, clipPaths, durationWarning, fitsPoster, fitsVideo, nextVersion, parseVideoInfo, posterArgs, registrySnippet,
  validClipId, videoArgs,
} from '../src/lib/tonito/clipPipeline';
import { TONITO_CLIPS } from '../src/lib/tonito/clips';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

function fail(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

function run(cmd: string, a: string[]) {
  return spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const input = val('--video');
const id = val('--id');
if (!input || !id) {
  console.log('Uso: npm run clip:prepare -- --video <archivo> --id <nombre-en-minusculas> [--scene streak] [--poster-at 1.5] [--loop] [--upload]');
  process.exit(1);
}
if (!validClipId(id)) fail(`el id "${id}" no vale: minusculas, numeros y guiones sueltos (por ejemplo "exito-total")`);
if (!fs.existsSync(input) || !fs.statSync(input).isFile()) fail(`no existe el video: ${input}`);

const probe = run(ffmpeg, ['-hide_banner', '-i', input]);
if (probe.error) fail(`no se pudo ejecutar ffmpeg (${ffmpeg}). Instalalo o pon su ruta en FFMPEG_PATH. Windows: winget install Gyan.FFmpeg`);
const info = parseVideoInfo(`${probe.stderr}`);
if (!info) fail('ffmpeg no reconoce ese archivo como video');
const warn = durationWarning(info.seconds);
console.log(`Original: ${info.width}x${info.height}, ${info.seconds.toFixed(1)} s, ${kb(fs.statSync(input).size)}`);
if (warn) console.log(`! ${warn}`);

const used = Object.values(TONITO_CLIPS).flatMap((c) => [c.src, c.poster]);
const version = nextVersion(id, used);
if (version > 1) console.log(`! el id "${id}" ya existe en el registro: se prepara la version v${version} (los archivos son inmutables)`);
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
console.log('  Revisa el poster y el video antes de subir: el script no puede juzgar si se ve bien, solo si cumple las reglas tecnicas.');

if (has('--upload')) {
  console.log('\nSubiendo…');
  const up = spawnSync(
    'npx',
    ['tsx', '--env-file=.env.local', 'scripts/media-upload.ts', '--file', videoOut, '--path', paths.video, '--file', posterOut, '--path', paths.poster],
    { stdio: 'inherit', shell: true },
  );
  if (up.status !== 0) fail('la subida fallo; no se registro nada');
} else {
  console.log(
    `\nPara subirlo:\n  npm run media:upload -- --file ${path.relative(process.cwd(), videoOut)} --path ${paths.video} --file ${path.relative(process.cwd(), posterOut)} --path ${paths.poster}`,
  );
}

console.log(`\n${registrySnippet({ id, version, width: out.width, height: out.height, loop: has('--loop'), scene: val('--scene') })}`);
