// Convierte las poses de Toñito generadas en Flow (imagen cuadrada sobre fondo magenta #FF00FF) en PNG transparentes de 512x512 para la app.
//
//   npm run pose:prepare -- --image ./P1.png --pose P1          (una pose; tambien --mood happy)
//   npm run pose:prepare -- --dir ./mis-poses                    (todas: archivos que empiezan por P1..P8, por ejemplo P1.png, P2-saltando.png)
//   npm run pose:prepare -- --dir ./mis-poses --apply            (ademas, copia los PNG a public/tonito/, que es lo que usa la app)
//
// Sin --apply solo deja los PNG en ./poses-out/ para que los revises (no toca la app). Imprime, por pose, que tan grande es Toñito y donde caen
// los pies, y avisa si una pose no calza con las demas (si los pies cambian de una a otra, al cambiar de emocion Toñito "salta").
// Necesita ffmpeg: en el PATH o en FFMPEG_PATH. (Windows: `winget install Gyan.FFmpeg`.)

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  POSE_CANVAS, POSE_MOOD, consistencyWarnings, despillMagenta, moodForPose, poseStats, poseWarnings, type PoseStats,
} from '../src/lib/tonito/posePipeline';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const WORK = 1024; // se quita el fondo a 1024 y luego se reduce a 512: los bordes quedan mas limpios
const OUT_DIR = path.join(process.cwd(), 'poses-out');
const APP_DIR = path.join(process.cwd(), 'public', 'tonito');

function fail(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

function run(args: string[]) {
  return spawnSync(ffmpeg, args, { maxBuffer: 256 * 1024 * 1024 });
}

// Devuelve los pixeles RGBA (WORK x WORK) con el magenta ya convertido en transparencia.
function keyOut(input: string): Uint8Array {
  const vf = [
    `scale=${WORK}:${WORK}:flags=lanczos:force_original_aspect_ratio=decrease`,
    `pad=${WORK}:${WORK}:(ow-iw)/2:(oh-ih)/2:color=0xFF00FF`,
    'colorkey=0xFF00FF:0.30:0.12',
    'format=rgba',
  ].join(',');
  const r = run(['-v', 'error', '-i', input, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  if (r.error) fail(`no se pudo ejecutar ffmpeg (${ffmpeg}). Instalalo o pon su ruta en FFMPEG_PATH. Windows: winget install Gyan.FFmpeg`);
  if (r.status !== 0 || !r.stdout || r.stdout.length !== WORK * WORK * 4) fail(`ffmpeg no pudo leer ${input}: ${String(r.stderr).trim().split('\n').pop()}`);
  return new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length);
}

function writePng(rgba: Uint8Array, out: string) {
  const tmp = path.join(os.tmpdir(), `pose-${process.pid}-${Date.now()}.raw`);
  fs.writeFileSync(tmp, rgba);
  const r = run([
    '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${WORK}x${WORK}`, '-i', tmp,
    '-frames:v', '1', '-vf', `scale=${POSE_CANVAS}:${POSE_CANVAS}:flags=lanczos,format=rgba`, out,
  ]);
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) fail(`ffmpeg no pudo escribir ${out}: ${String(r.stderr).trim().split('\n').pop()}`);
}

interface Job { file: string; mood: string }

function collectJobs(): Job[] {
  const image = val('--image');
  const dir = val('--dir');
  if (image) {
    const key = val('--pose') ?? val('--mood');
    if (!key) fail('con --image hace falta --pose P1..P8 (o --mood happy, excited, ...)');
    const mood = moodForPose(key);
    if (!mood) fail(`"${key}" no es una pose conocida. Poses: ${Object.keys(POSE_MOOD).join(', ')}.`);
    if (!fs.existsSync(image)) fail(`no existe ${image}`);
    return [{ file: image, mood }];
  }
  if (dir) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`no existe la carpeta ${dir}`);
    const jobs: Job[] = [];
    for (const name of fs.readdirSync(dir).sort()) {
      const m = name.match(/^(P[1-8])(?![0-9])/i);
      if (!m || !/\.(png|jpe?g|webp)$/i.test(name)) continue;
      const mood = moodForPose(m[1]);
      if (mood && !jobs.some((j) => j.mood === mood)) jobs.push({ file: path.join(dir, name), mood });
    }
    if (jobs.length === 0) fail(`en ${dir} no hay imagenes que empiecen por P1..P8 (por ejemplo P1.png)`);
    return jobs;
  }
  fail('uso: --image <archivo> --pose P1   o   --dir <carpeta> [--apply]');
}

const jobs = collectJobs();
fs.mkdirSync(OUT_DIR, { recursive: true });

const stats: Record<string, PoseStats> = {};
let problems = 0;
for (const { file, mood } of jobs) {
  const rgba = keyOut(file);
  const spilled = despillMagenta(rgba);
  const s = poseStats(rgba, WORK, WORK);
  const warns = poseWarnings(s);
  const out = path.join(OUT_DIR, `${mood}.png`);
  if (s) {
    writePng(rgba, out);
    stats[mood] = s;
    console.log(`${warns.length ? '⚠' : '✔'} ${mood.padEnd(12)} ${path.basename(file)} -> poses-out/${mood}.png   altura ${s.heightPct}%  pies ${s.feetPct}%  centro ${s.centroPct}%  (${spilled} bordes limpiados)`);
  } else {
    console.log(`✘ ${mood.padEnd(12)} ${path.basename(file)}`);
  }
  for (const w of warns) console.log(`    ⚠ ${w}`);
  if (warns.length) problems++;
}

const cons = consistencyWarnings(stats);
if (cons.length) {
  console.log('\nEntre poses:');
  for (const w of cons) console.log(`  ⚠ ${w}`);
}

const missing = Object.values(POSE_MOOD).filter((m) => !stats[m]);
if (jobs.length > 1 && missing.length) console.log(`\nFaltan: ${missing.join(', ')}`);

if (has('--apply')) {
  if (problems > 0) fail('hay poses con avisos: revisa poses-out/ y corrigelas antes de usar --apply (no se copio nada a la app)');
  fs.mkdirSync(APP_DIR, { recursive: true });
  for (const mood of Object.keys(stats)) fs.copyFileSync(path.join(OUT_DIR, `${mood}.png`), path.join(APP_DIR, `${mood}.png`));
  console.log(`\n✔ Copiadas a public/tonito/: ${Object.keys(stats).join(', ')}`);
  console.log('  Ojo: la app solo usa celebrating y sleeping cuando TonitoCharacter apunta a esos archivos (hoy reutiliza excited y sad).');
} else {
  console.log('\nRevisa los PNG en poses-out/. Para ponerlos en la app: el mismo comando con --apply.');
}
