// REPONE las preguntas retiradas: para cada modulo afectado por un retiro (npm run retire:questions), genera lo que le falta al pool (modo 'fill' de
// regenerateModulePool: activas + reserva hasta la cantidad configurada), y JUZGA solo las preguntas NUEVAS con el mismo juez de siempre (correccion + segunda
// opinion): pass -> approved, fail -> rejected (is_backup), review o sin veredicto -> human_review. Nunca aprueba por omision.
//
//   npm run replenish:pools                              (SIMULACRO: muestra cuantas faltan por modulo; no genera ni escribe)
//   npm run replenish:pools -- --aplicar                 (genera y juzga)
//   npm run replenish:pools -- --retiro evals/runs/retiro-<fecha>.json --aplicar --pausa 20
//
// Usa el generador nuevo: GENERATION_PRIMARY=gateway (Gemini 3.5 Flash-Lite con AI_PROFILE=paid). Genera por ESTE script con la llave de servicio: no pasa por la
// sesion de un profesor. Las preguntas viejas no se tocan.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { regenerateModulePool } from '../src/lib/questions/regeneratePool';
import { getRagContext } from '../src/lib/questions/cohereGeneration';
import { judgeQuestionsBatch } from '../src/lib/questions/judge';
import { countServable, planFill, resolveQuestionCount } from '../src/lib/questions/poolPlan';
import { sharedHealth } from '../src/lib/ai/gateway';

const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const aplicar = args.includes('--aplicar');
const pausa = Number(val('--pausa') ?? 15);

// El generador nuevo, salvo que el entorno diga otra cosa.
process.env.GENERATION_PRIMARY = process.env.GENERATION_PRIMARY || 'gateway';
process.env.AI_PROFILE = process.env.AI_PROFILE || 'paid';

const dir = path.join(process.cwd(), 'evals', 'runs');

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const retiroPath = val('--retiro') ?? path.join(dir, fs.readdirSync(dir).filter((x) => /^retiro-.*\.json$/.test(x)).sort().pop()!);
  const retiro = JSON.parse(fs.readFileSync(retiroPath, 'utf8')) as { filas: { module_id: string; modulo: string }[] };
  const modulos = Array.from(new Map(retiro.filas.map((f) => [f.module_id, f.modulo])).entries());
  console.log(`Retiro: ${path.relative(process.cwd(), retiroPath)} | modulos afectados: ${modulos.length} | generador: ${process.env.GENERATION_PRIMARY} / perfil ${process.env.AI_PROFILE}${aplicar ? '' : '  (SIMULACRO)'}\n`);

  let totalNuevas = 0, aprobadas = 0, rechazadas = 0, revision = 0;
  for (const [moduleId, titulo] of modulos) {
    const { data: m } = await supabase.from('content_modules').select('configured_question_count').eq('id', moduleId).single();
    const { data: filas } = await supabase.from('lesson_questions').select('id, is_backup, review_status').eq('module_id', moduleId);
    const plan = planFill(resolveQuestionCount(m?.configured_question_count), countServable(filas ?? []));
    console.log(`${titulo.slice(0, 56).padEnd(56)} faltan: ${plan.needActive} activas + ${plan.needBackup} reserva`);
    if (!aplicar || plan.complete) continue;

    sharedHealth.reset();
    const antes = new Set((filas ?? []).map((f: any) => f.id));
    const res = await regenerateModulePool(supabase, moduleId, { mode: 'fill' });
    if (!res.ok) {
      console.log(`    ✘ no se pudo generar: ${res.error}`);
      continue;
    }
    const { data: despues } = await supabase.from('lesson_questions').select('*').eq('module_id', moduleId);
    const nuevas = (despues ?? []).filter((f: any) => !antes.has(f.id));
    totalNuevas += nuevas.length;

    // Juicio de las NUEVAS, con la misma regla de judgeModuleQuestionPool (learning-objectives.ts).
    const contexto = await getRagContext(supabase, moduleId);
    const veredictos = await judgeQuestionsBatch(nuevas, contexto);
    const ahora = new Date().toISOString();
    let a = 0, r = 0, h = 0;
    for (const q of nuevas) {
      const v = veredictos.get(q.id);
      const upd =
        v?.verdict === 'pass' ? { review_status: 'approved', review_reason: v.reason }
        : v?.verdict === 'fail' ? { review_status: 'rejected', is_backup: true, review_reason: v.reason }
        : { review_status: 'human_review', review_reason: v?.reason ?? 'El juez no pudo emitir veredicto (cuota agotada, sin API key o respuesta ilegible).' };
      if (upd.review_status === 'approved') a++; else if (upd.review_status === 'rejected') r++; else h++;
      const { error } = await supabase.from('lesson_questions').update({ ...upd, reviewed_by: 'ai_judge', reviewed_at: ahora }).eq('id', q.id);
      if (error) throw new Error(error.message);
    }
    aprobadas += a; rechazadas += r; revision += h;
    console.log(`    ✔ generadas ${nuevas.length} | aprobadas ${a} | rechazadas ${r} | revision humana ${h}`);
    if (pausa > 0) await new Promise((r2) => setTimeout(r2, pausa * 1000));
  }

  if (!aplicar) return console.log('\nSIMULACRO: no se genero ni escribio nada. Para reponer: npm run replenish:pools -- --aplicar');
  console.log(`\n=== TOTAL === generadas ${totalNuevas} | aprobadas ${aprobadas} | rechazadas ${rechazadas} | revision humana ${revision}`);
}

main().catch((e) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
