// Ver, apagar y encender los clips de las cinematicas de Toñito (tabla tonito_scene_clips). Cambia lo que ven los estudiantes en pocos
// minutos, sin redesplegar. Flujo completo: docs/TONITO_CINEMATICAS.md.
//
//   npm run clip:list                          (que usa cada escena ahora)
//   npm run clip:off -- --scene welcome        (apaga el clip: la escena vuelve a la pose animada)
//   npm run clip:on  -- --scene welcome        (lo enciende otra vez)
//
// Necesita .env.local con SUPABASE_SERVICE_ROLE_KEY (nunca se imprime).

import { createClient } from '@supabase/supabase-js';
import { TONITO_CLIPS } from '../src/lib/tonito/clips';
import { CINEMATIC_TYPES, SCENE_DEFAULT_CLIP, isCinematicType } from '../src/lib/tonito/scenes';

const [cmd, ...rest] = process.argv.slice(2);
const scene = rest[rest.indexOf('--scene') + 1];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const redact = (s: string) => (key ? s.split(key).join('[CLAVE]') : s);

function fail(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

async function main() {
  if (!['list', 'on', 'off'].includes(cmd)) fail('Uso: npm run clip:list | clip:off -- --scene <escena> | clip:on -- --scene <escena>');
  if (!url || !key) fail('faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (cmd === 'list') {
    const { data, error } = await supabase.from('tonito_scene_clips').select('scene, clip_id, src, active, updated_at');
    if (error) fail(`${redact(error.message)}. ¿Ya se aplico la migracion 073?`);
    const rows = new Map((data ?? []).map((r: any) => [r.scene, r]));
    console.log('Escena                  Estado    Clip');
    for (const s of CINEMATIC_TYPES) {
      const r: any = rows.get(s);
      const fromCode = SCENE_DEFAULT_CLIP[s] ? TONITO_CLIPS[SCENE_DEFAULT_CLIP[s]!] : undefined;
      const estado = r ? (r.active ? 'activo' : 'APAGADO') : fromCode ? 'codigo' : 'sin video';
      const clip = r ? `${r.clip_id}  (${r.src})` : fromCode ? `${fromCode.id}  (respaldo del codigo)` : '—';
      console.log(`${s.padEnd(23)} ${estado.padEnd(9)} ${clip}`);
    }
    return;
  }

  if (!scene || !isCinematicType(scene)) fail(`indica una escena con --scene. Escenas: ${CINEMATIC_TYPES.join(', ')}`);
  const active = cmd === 'on';
  const { data, error } = await supabase.from('tonito_scene_clips').update({ active, updated_at: new Date().toISOString() }).eq('scene', scene).select('scene');
  if (error) fail(redact(error.message));
  if (!data?.length) fail(`la escena "${scene}" no tiene clip publicado en la base (no hay nada que ${active ? 'encender' : 'apagar'}). Mira: npm run clip:list`);
  console.log(`✔ "${scene}": ${active ? 'encendida' : 'apagada'}. Los estudiantes lo notan en pocos minutos.`);
}

main().catch((e) => {
  console.error('FALLO:', redact(e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
});
