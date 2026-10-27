// Mide los COLORES DE BORDE de un clip y, opcionalmente, los guarda en la fila de su escena. Con ellos la escena pinta detras del clip lo mismo que el clip trae en sus
// bordes, y en una pantalla ancha (computador) ya no se distingue la columna vertical de los lados. Ver src/lib/tonito/clipColors.ts.
//
//   npm run clip:colors -- --scene module_complete_good            (mide el poster publicado y MUESTRA los colores; no escribe)
//   npm run clip:colors -- --scene module_complete_good --aplicar  (ademas los guarda en tonito_scene_clips.bg_colors)
//   npm run clip:colors -- --archivo ./clips-out/clip.v1.mp4        (mide un archivo local)
//
// Hace falta la migracion 074 (columna bg_colors) para --aplicar. `npm run clip:publish` ya hace esto solo al publicar un clip nuevo.

import { createClient } from '@supabase/supabase-js';
import { mediaUrl } from '../src/lib/tonito/media';
import { supabasePublicBase } from '../src/lib/tonito/mediaUpload';
import { edgeBackgrounds, whiteTextContrast } from '../src/lib/tonito/clipColors';
import { measureEdgeColors } from './lib/measureEdgeColors';

const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const aplicar = args.includes('--aplicar');
const scene = val('--scene');
const archivo = val('--archivo');

async function main() {
  if (!scene && !archivo) {
    console.log('Uso: npm run clip:colors -- --scene <escena> [--aplicar]   |   npm run clip:colors -- --archivo <clip.mp4>');
    process.exit(1);
  }

  let input = archivo!;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = scene && url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

  if (scene) {
    if (!supabase) throw new Error('faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
    const { data, error } = await supabase.from('tonito_scene_clips').select('poster').eq('scene', scene).maybeSingle();
    if (error) throw new Error(error.message.replace(key!, '[CLAVE]'));
    if (!data) throw new Error(`la escena "${scene}" no tiene clip publicado (npm run clip:list)`);
    input = mediaUrl(data.poster, supabasePublicBase(url!)); // el poster es el primer cuadro del clip
  }

  console.log(`Midiendo: ${input}`);
  const colors = measureEdgeColors(input);
  const names = ['izquierda arriba', 'izquierda medio', 'izquierda abajo', 'derecha arriba', 'derecha medio', 'derecha abajo'];
  colors.forEach((c, i) => console.log(`  ${names[i].padEnd(17)} ${c}   contraste del texto blanco solo: ${whiteTextContrast(c).toFixed(1)}:1`));
  const bg = edgeBackgrounds(colors)!;
  console.log(`\nFondo izquierdo: ${bg.left}\nFondo derecho:   ${bg.right}`);
  console.log('(La escena pone un velo oscuro bajo el texto, asi que un contraste bajo aqui no significa que no se lea; compruebalo en pantalla.)');

  if (!scene) return;
  if (!aplicar) {
    console.log('\nSOLO MEDIDO: no se guardo nada. Para guardarlo: agrega --aplicar');
    return;
  }
  const { data, error } = await supabase!.from('tonito_scene_clips').update({ bg_colors: colors, updated_at: new Date().toISOString() }).eq('scene', scene).select('scene');
  if (error) {
    const msg = error.message.replace(key!, '[CLAVE]');
    throw new Error(`${msg}${/bg_colors/.test(msg) ? ' — ¿ya se aplico la migracion 074?' : ''}`);
  }
  if (!data?.length) throw new Error('no se actualizo ninguna fila');
  console.log(`\n✔ Guardado en "${scene}". Los estudiantes lo ven en pocos minutos (cache), sin redesplegar.`);
}

main().catch((e) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
