// Imprime (o escribe) los prompts de Flow para el arte de Toñito, ya armados. Catalogo: src/lib/tonito/flowPrompts.ts. Plan: docs/TONITO_CATALOGO_ANIMACIONES.md.
//
//   npm run flow:prompts -- A1 vertical        (un clip: A1..A5, B1..B3 en vertical u horizontal)
//   npm run flow:prompts -- P2                 (una pose: P1..P8)
//   npm run flow:prompts -- --lista            (que hay y que falta)
//   npm run flow:prompts -- --escribir         (regenera docs/TONITO_FLOW_PROMPTS.md)

import fs from 'fs';
import path from 'path';
import { CLIPS, POSES, buildClipPrompt, buildPosePrompt, clipById, pendingCount, poseById, renderPromptsDoc, type Orientation } from '../src/lib/tonito/flowPrompts';

const args = process.argv.slice(2);
const DOC = path.join(process.cwd(), 'docs', 'TONITO_FLOW_PROMPTS.md');

if (args.includes('--escribir')) {
  fs.writeFileSync(DOC, renderPromptsDoc());
  console.log(`Escrito: ${path.relative(process.cwd(), DOC)}`);
} else if (args.includes('--lista') || args.length === 0) {
  const p = pendingCount();
  console.log(`Por generar: ${p.clips} clips + ${p.poses} poses = ${p.total}\n`);
  for (const c of CLIPS) {
    const estado = c.orientations.map((o) => `${o === 'vertical' ? 'celular' : 'computador'} ${c.done?.includes(o) ? '☑' : '☐'}`).join(' · ');
    console.log(`${c.id.padEnd(3)} ${c.title.slice(0, 62).padEnd(62)} ${estado}`);
  }
  for (const s of POSES) console.log(`${s.id.padEnd(3)} pose ${s.mood.padEnd(58)} ${s.priority}`);
  console.log('\nUso: npm run flow:prompts -- A1 vertical | npm run flow:prompts -- P2 | npm run flow:prompts -- --escribir');
} else {
  const [id, orient] = args;
  const clip = clipById(id);
  const pose = poseById(id);
  if (clip) {
    const o = (orient ?? clip.orientations[0]) as Orientation;
    if (o !== 'vertical' && o !== 'horizontal') throw new Error('La orientacion es "vertical" o "horizontal"');
    console.log(buildClipPrompt(clip, o));
  } else if (pose) {
    console.log(buildPosePrompt(pose));
  } else {
    console.error(`No existe "${id}". Usa --lista para ver los ids.`);
    process.exitCode = 1;
  }
}
