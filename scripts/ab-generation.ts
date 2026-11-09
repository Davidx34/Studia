// EXPERIMENTO A/B DE GENERACION (no escribe preguntas en la base): ¿un conjunto de reglas REDUCE los errores del generador?
// Brazo A = como genera hoy; brazo B = igual + las reglas candidatas en el prompt (el mismo bloque que leeria un cuaderno activo). MISMOS modulos, MISMO contexto, MISMO juez, brazos INTERCALADOS
// (A,B,A,B...) para que los cambios de carga o cuota del proveedor afecten a los dos por igual. La decision usa un intervalo de confianza de la diferencia (proportion.ts): solo se dice «mejora» si el
// intervalo queda entero del lado bueno y hay muestra minima; «sin evidencia» NO significa «no sirve», significa «mide mas antes de cambiar nada».
//
//   npx tsx --env-file=.env.local scripts/ab-generation.ts --reglas item_writing_v1 --modulos 4 --reps 2 --pausa 20 --guardar
//
// Exito = la pregunta pasa el juez. Los veredictos «review» causados por la INFRAESTRUCTURA (segunda opinion no disponible, cuota) se excluyen del denominador de los DOS brazos: no son culpa del generador.
// Guarda el resultado (solo conteos y categorias, sin texto de preguntas ni de materiales) en memoria-calidad/experimentos/.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { isValidQuestion } from '../src/lib/lesson/validateQuestion';
import { getRagContext, normalizeGeneratedQuestion, callCohere } from '../src/lib/questions/cohereGeneration';
import { buildGenerationPrompt, enforceAllowedTypes, resolveConfig } from '../src/lib/questions/generationConfig';
import { conceptTaxonomyPromptBlock } from '../src/lib/questions/conceptTaxonomy';
import { judgeQuestionsBatch } from '../src/lib/questions/judge';
import { sharedHealth } from '../src/lib/ai/gateway';
import { playbookPromptBlock } from '../src/lib/aiLearning/playbook';
import { RULE_SETS, ruleSetNames, toPlaybookRules } from '../src/lib/aiLearning/experimentRules';
import { CATEGORIES, classifyReason } from '../src/lib/aiLearning/errorTaxonomy';
import { compareProportions } from '../src/lib/aiLearning/proportion';

const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const reglas = val('--reglas') ?? 'item_writing_v1';
const nModulos = Number(val('--modulos') ?? 4);
const reps = Number(val('--reps') ?? 2);
const count = Number(val('--count') ?? 8);
const pausa = Number(val('--pausa') ?? 15);
const gen = val('--gen') ?? 'gemini:gemini-3.5-flash-lite';
const guardar = args.includes('--guardar');
const pct = (x: number | null) => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);

if (!RULE_SETS[reglas]) {
  console.error(`Conjunto desconocido: ${reglas}. Disponibles: ${ruleSetNames().join(', ')}`);
  process.exit(1);
}

type Arm = 'A' | 'B';
interface ArmStats {
  pedidas: number;
  generadas: number;
  validasForma: number;
  pass: number;
  fail: number;
  reviewGenerador: number;
  excluidasInfra: number;
  porCategoria: Record<string, number>;
}
const newStats = (): ArmStats => ({ pedidas: 0, generadas: 0, validasForma: 0, pass: 0, fail: 0, reviewGenerador: 0, excluidasInfra: 0, porCategoria: {} });

async function main() {
  // Un solo candidato en la cadena de generacion (igual que eval-generation): el brazo no depende de otro proveedor.
  process.env.COHERE_API_KEY = '';
  process.env.AI_CHAIN_GENERATION = gen;
  process.env.AI_PROFILE = process.env.AI_PROFILE || 'paid';

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: rev } = await db.from('lesson_questions').select('module_id').eq('reviewed_by', 'teacher');
  const ids = val('--ids')?.split(',') ?? Array.from(new Set((rev ?? []).map((r: any) => r.module_id as string))).slice(0, nModulos);
  if (ids.length === 0) return console.log('No hay modulos candidatos. Usa --ids <id,id>.');

  const mods: { id: string; title: string; config: any; context: string; conceptBlock: string }[] = [];
  for (const id of ids) {
    const { data: m } = await db.from('content_modules').select('id, classroom_id, title').eq('id', id).single();
    if (!m) continue;
    const { data: cfg } = await db.from('classroom_ai_config').select('*').eq('classroom_id', m.classroom_id).maybeSingle();
    const { data: concepts } = await db.from('classroom_concepts').select('tag, label').eq('module_id', id);
    mods.push({ id, title: m.title, config: resolveConfig(cfg), context: await getRagContext(db, id), conceptBlock: conceptTaxonomyPromptBlock(concepts ?? []) });
  }
  const block = playbookPromptBlock(toPlaybookRules(reglas));
  console.log(`Experimento: ${reglas} | modulos: ${mods.length} | repeticiones: ${reps} | preguntas por llamada: ${count} (sin minijuegos) | generador: ${gen}\nBloque B (${block.length} caracteres):\n${block}\n`);

  const stats: Record<Arm, ArmStats> = { A: newStats(), B: newStats() };
  let sinRespuesta = 0;

  // Los brazos se evaluan en PARES (mismo modulo y repeticion): un par solo cuenta si AMBOS brazos respondieron, para que nunca queden desiguales. Ante 3 fallos de generacion seguidos
  // (cuota agotada, credito prepagado agotado, proveedor caido) el experimento se DETIENE y queda marcado como incompleto en vez de seguir y producir una comparacion desigual.
  const MAX_FALLOS_SEGUIDOS = 3;
  let fallosSeguidos = 0;
  let parAbortado: string | null = null;
  let pares = 0;

  const runArm = async (arm: Arm, mm: (typeof mods)[number], rep: number): Promise<ArmStats | null> => {
    const built = buildGenerationPrompt({ config: mm.config, moduleTitle: mm.title, context: mm.context, classicCount: count, minigames: [], conceptBlock: mm.conceptBlock, playbookBlock: arm === 'B' ? block : '' });
    sharedHealth.reset();
    const raw = (await callCohere(built.prompt, built.total).catch(() => null)) ?? [];
    if (raw.length === 0) return null;
    const s = newStats();
    s.pedidas = built.total;
    s.generadas = raw.length;
    const { kept } = enforceAllowedTypes(raw.map(normalizeGeneratedQuestion), new Set(built.requestedTypes));
    const validas = kept.filter((q: any) => isValidQuestion(q).valid).map((q: any, i: number) => ({ ...q, id: `${arm}-${rep}-${mm.id.slice(0, 4)}-${i}` }));
    s.validasForma = validas.length;
    const veredictos = validas.length ? await judgeQuestionsBatch(validas, mm.context) : new Map();
    for (const q of validas) {
      const v = veredictos.get(q.id);
      if (v?.verdict === 'pass') s.pass++;
      else {
        const cat = classifyReason(v?.reason ?? null);
        if (CATEGORIES[cat].origin === 'infraestructura' || !v) {
          s.excluidasInfra++;
          continue;
        }
        s.porCategoria[cat] = (s.porCategoria[cat] ?? 0) + 1;
        if (v.verdict === 'fail') s.fail++;
        else s.reviewGenerador++;
      }
    }
    return s;
  };
  const add = (t: ArmStats, d: ArmStats) => {
    for (const k of ['pedidas', 'generadas', 'validasForma', 'pass', 'fail', 'reviewGenerador', 'excluidasInfra'] as const) t[k] += d[k];
    for (const [c, nn] of Object.entries(d.porCategoria)) t.porCategoria[c] = (t.porCategoria[c] ?? 0) + nn;
  };

  outer: for (let rep = 0; rep < reps; rep++) {
    for (const mm of mods) {
      const a = await runArm('A', mm, rep);
      const b = await runArm('B', mm, rep);
      if (!a || !b) {
        sinRespuesta += (a ? 0 : 1) + (b ? 0 : 1);
        fallosSeguidos++;
        console.log(`  rep ${rep + 1} ${mm.title.slice(0, 34).padEnd(34)} PAR DESCARTADO (A ${a ? 'ok' : 'sin respuesta'}, B ${b ? 'ok' : 'sin respuesta'}) | fallos seguidos ${fallosSeguidos}`);
        if (fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
          parAbortado = `${MAX_FALLOS_SEGUIDOS} pares seguidos sin respuesta de la generacion (cuota o credito agotado, o proveedor caido)`;
          break outer;
        }
      } else {
        fallosSeguidos = 0;
        pares++;
        add(stats.A, a);
        add(stats.B, b);
        console.log(`  rep ${rep + 1} ${mm.title.slice(0, 34).padEnd(34)} par ok | A pass ${stats.A.pass} fail ${stats.A.fail} rev ${stats.A.reviewGenerador} | B pass ${stats.B.pass} fail ${stats.B.fail} rev ${stats.B.reviewGenerador} | infra A${stats.A.excluidasInfra} B${stats.B.excluidasInfra}`);
      }
      if (pausa > 0) await new Promise((r) => setTimeout(r, pausa * 1000));
    }
  }
  if (parAbortado) console.log(`
*** EXPERIMENTO INTERRUMPIDO: ${parAbortado}. Se cuentan solo los pares completos (${pares}); el resultado es INCOMPLETO. ***`);

  const n = (s: ArmStats) => s.pass + s.fail + s.reviewGenerador; // denominador: con veredicto atribuible al generador
  const cmpPass = compareProportions({ successes: stats.A.pass, n: n(stats.A) }, { successes: stats.B.pass, n: n(stats.B) });
  const cmpForma = compareProportions({ successes: stats.A.validasForma, n: stats.A.generadas }, { successes: stats.B.validasForma, n: stats.B.generadas });

  console.log('\n=== RESULTADO ===');
  for (const arm of ['A', 'B'] as Arm[]) {
    const s = stats[arm];
    console.log(`Brazo ${arm}${arm === 'B' ? ' (con reglas)' : ' (base)'}: generadas ${s.generadas} | validas de forma ${s.validasForma} | con veredicto ${n(s)} | pasan ${s.pass} (${pct(n(s) ? s.pass / n(s) : null)}) | excluidas por infraestructura ${s.excluidasInfra}`);
    console.log(`   errores: ${JSON.stringify(s.porCategoria)}`);
  }
  console.log(`Pasan el juez: B - A = ${cmpPass.diff === null ? '-' : (cmpPass.diff * 100).toFixed(1) + ' pp'}  IC95% [${pct(cmpPass.diffCi?.low ?? null)}, ${pct(cmpPass.diffCi?.high ?? null)}]  => ${cmpPass.decision.toUpperCase()}`);
  console.log(`Validas de forma: B - A = ${cmpForma.diff === null ? '-' : (cmpForma.diff * 100).toFixed(1) + ' pp'}  => ${cmpForma.decision.toUpperCase()}`);
  if (sinRespuesta) console.log(`Llamadas de generacion sin respuesta legible: ${sinRespuesta}`);

  if (guardar) {
    const dir = path.join(process.cwd(), 'memoria-calidad', 'experimentos');
    fs.mkdirSync(dir, { recursive: true });
    const id = `${new Date().toISOString().slice(0, 10)}-${reglas}`;
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify({ id, fecha: new Date().toISOString(), reglas, generador: gen, modulos: mods.length, repeticiones: reps, preguntasPorLlamada: count, bloqueB: block, brazos: stats, comparacionPasanJuez: cmpPass, comparacionFormaValida: cmpForma, llamadasSinRespuesta: sinRespuesta, paresCompletos: pares, paresPrevistos: reps * mods.length, incompleto: !!parAbortado || pares < reps * mods.length, motivoIncompleto: parAbortado }, null, 2) + '\n',
    );
    console.log(`Guardado: memoria-calidad/experimentos/${id}.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
