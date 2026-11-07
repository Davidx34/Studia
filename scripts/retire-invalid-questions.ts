// RETIRA de circulacion las preguntas que el validador de FORMA actual (isValidQuestion) ya no deja servir: asi cuentan como faltantes y `replenish:pools` las repone.
// REVERSIBLE: guarda los valores anteriores de cada fila en evals/runs/retiro-<fecha>.json (mismo formato que retire:questions), y `retire:questions -- --revertir <archivo> --aplicar` las restaura.
//
//   npx tsx --env-file=.env.local scripts/retire-invalid-questions.ts                (SIMULACRO: no escribe nada)
//   npx tsx --env-file=.env.local scripts/retire-invalid-questions.ts --aplicar
//
// "Retirar" = review_status = 'rejected' e is_backup = true (lo mismo que hace el juez con un fail). NO borra filas: los intentos de los estudiantes siguen apuntando a ellas.
// reviewed_by queda en NULL y la razon lleva el prefijo «[validador de forma]»: no es una decision del juez IA ni del profesor, asi que no debe contarse como tal al calibrar al juez.
// Excluye las clases de prueba de carga ([CARGA]).

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { isValidQuestion } from '../src/lib/lesson/validateQuestion';
import { rowToQuestion } from '../src/lib/questions/poolServing';

const aplicar = process.argv.includes('--aplicar');
const dir = path.join(process.cwd(), 'evals', 'runs');

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: mods, error: me } = await supabase.from('content_modules').select('id, title, classrooms(name)');
  if (me) throw new Error(me.message);
  const real = new Map<string, string>();
  for (const m of (mods ?? []) as any[]) if (!String(m.classrooms?.name ?? '').startsWith('[CARGA]')) real.set(m.id, m.title);

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('lesson_questions').select('*').neq('review_status', 'rejected').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const invalidas = rows
    .filter((r) => real.has(r.module_id))
    .map((r) => ({ r, v: isValidQuestion(rowToQuestion(r)) as any }))
    .filter((x) => !x.v.valid);

  const porModulo = new Map<string, number>();
  for (const { r } of invalidas) porModulo.set(r.module_id, (porModulo.get(r.module_id) ?? 0) + 1);
  console.log(`Preguntas no rechazadas en clases reales: ${rows.filter((r) => real.has(r.module_id)).length} | invalidas por forma: ${invalidas.length} | modulos afectados: ${porModulo.size}${aplicar ? '' : '  (SIMULACRO)'}`);
  for (const [id, n] of porModulo) console.log(`  ${String(real.get(id)).slice(0, 56).padEnd(56)} -${n}`);

  if (!aplicar) return console.log('\nSIMULACRO: no se escribio nada. Para retirarlas: --aplicar');

  const ahora = new Date().toISOString();
  const filas: any[] = [];
  let hechas = 0;
  for (const { r, v } of invalidas) {
    const motivo = `[validador de forma] ${String(v.reason ?? v.error ?? 'no cumple las reglas de forma').slice(0, 300)}`;
    filas.push({
      id: r.id,
      module_id: r.module_id,
      modulo: real.get(r.module_id),
      motivo,
      antes: { review_status: r.review_status, is_backup: r.is_backup, reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at, review_reason: r.review_reason },
    });
  }
  // Primero se guarda la copia: si algo falla a medias, se puede revertir lo ya escrito.
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `retiro-${ahora.replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ fecha: ahora, origen: 'validador de forma (isValidQuestion)', filas }, null, 2));
  for (const f of filas) {
    // Solo si sigue como se leyo (no pisa un cambio posterior de una persona).
    const { data, error } = await supabase
      .from('lesson_questions')
      .update({ review_status: 'rejected', is_backup: true, reviewed_by: null, reviewed_at: ahora, review_reason: f.motivo })
      .eq('id', f.id)
      .eq('review_status', f.antes.review_status)
      .select('id');
    if (error) throw new Error(error.message);
    if (data?.length) hechas++;
  }
  console.log(`\nRetiradas: ${hechas} de ${filas.length}. Copia para revertir: ${path.relative(process.cwd(), archivo)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
