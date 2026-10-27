// PRUEBA DE GENERACION (solo lectura): ¿que generador produce preguntas que el juez aprueba, y cuanto sube el acierto si las rechazadas se
// REPARAN? No escribe NADA en la base: genera, juzga e imprime.
//
// Por que existe: las preguntas que fallan hoy las genera Cohere Aya Expanse 32B (callCohere lo usa PRIMERO; la cadena de la pasarela solo entra si
// Cohere no da suficientes), asi que AI_PROFILE=paid nunca las toco. Aqui se pone a competir cada generador sobre los MISMOS modulos, el MISMO
// contexto y el MISMO juez (criterio de correccion + segunda opinion de otra familia).
//
//   npm run eval:generation -- --gen cohere,gemini:gemini-3.5-flash-lite,gemini:gemini-3.5-flash --count 8
//   npm run eval:generation -- --gen gemini:gemini-3.5-flash-lite --reparar 2          (ciclo de reparacion: hasta 2 rondas)
//   npm run eval:generation -- --modulos 2 --sin-minijuegos --guardar
//
// Cada generador gasta: 1 llamada de generacion por modulo (+1 por ronda de reparacion), el juez y la segunda opinion. El juez usa el perfil de IA del
// entorno (AI_PROFILE=paid recomendado). Si el generador es de la misma familia que el juez (Gemini genera y Gemini juzga), la segunda opinion (otra
// familia) es la que contrasta.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { isValidQuestion } from '../src/lib/lesson/validateQuestion';
import { getRagContext, normalizeGeneratedQuestion, callCohere } from '../src/lib/questions/cohereGeneration';
import { buildGenerationPrompt, enforceAllowedTypes, resolveConfig, resolveMinigames } from '../src/lib/questions/generationConfig';
import { conceptTaxonomyPromptBlock } from '../src/lib/questions/conceptTaxonomy';
import { resolveQuestionCount } from '../src/lib/questions/poolPlan';
import { judgeQuestionsBatch, type JudgeResult } from '../src/lib/questions/judge';
import { repairFeedbackBlock } from '../src/lib/questions/repair';
import { sharedHealth } from '../src/lib/ai/gateway';

const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const has = (f: string) => args.includes(f);

const gens = (val('--gen') ?? 'cohere,gemini:gemini-3.5-flash-lite,gemini:gemini-3.5-flash').split(',').map((s) => s.trim()).filter(Boolean);
const nModulos = Number(val('--modulos') ?? 5);
const count = Number(val('--count') ?? 8);
const rondas = Number(val('--reparar') ?? 0);
const conMinijuegos = !has('--sin-minijuegos');
const guardar = has('--guardar');
// Pausa entre modulos (segundos): la segunda opinion usa proveedores gratuitos (Groq) que se agotan por minuto si se les da todo de golpe; una segunda
// opinion agotada manda la pregunta a revision y distorsiona la comparacion.
const pausa = Number(val('--pausa') ?? 0);
const COHERE_KEY = process.env.COHERE_API_KEY;

type Verdict = JudgeResult['verdict'] | 'sin_veredicto';
interface Row { id: string; q: any; verdict: Verdict; reason: string; ronda: number }
interface ModuleResult { modulo: string; pedidas: number; generadas: number; validas: number; pasanRonda0: number; pasanFinal: number; review: number; fail: number; segundos: number; filas: Row[] }

function pinGenerator(spec: string) {
  // cohere: tal cual (Cohere primero, y la cadena de la pasarela solo de respaldo). Otro: se quita Cohere y se fija la cadena de generacion.
  if (spec === 'cohere') {
    if (COHERE_KEY) process.env.COHERE_API_KEY = COHERE_KEY;
    delete process.env.AI_CHAIN_GENERATION;
  } else {
    process.env.COHERE_API_KEY = '';
    process.env.AI_CHAIN_GENERATION = spec;
  }
}

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Los modulos donde el profesor ya reviso preguntas: son los mismos de eval:judge, asi los resultados se pueden contrastar.
  const idsArg = val('--ids');
  let moduleIds: string[];
  if (idsArg) moduleIds = idsArg.split(',');
  else {
    const { data } = await supabase.from('lesson_questions').select('module_id').eq('reviewed_by', 'teacher');
    moduleIds = Array.from(new Set((data ?? []).map((r: any) => r.module_id as string))).slice(0, nModulos);
  }
  if (moduleIds.length === 0) return console.log('No hay modulos con preguntas revisadas por el profesor. Usa --ids <id,id>.');

  // Contexto y configuracion UNA vez por modulo: todos los generadores reciben exactamente lo mismo.
  const mods = new Map<string, any>();
  for (const id of moduleIds) {
    const { data: m } = await supabase.from('content_modules').select('id, classroom_id, title, description, minigame_types, configured_question_count').eq('id', id).single();
    if (!m) continue;
    const { data: aiConfig } = await supabase.from('classroom_ai_config').select('*').eq('classroom_id', m.classroom_id).maybeSingle();
    const { data: concepts } = await supabase.from('classroom_concepts').select('tag, label').eq('module_id', id); // solo lectura: no se crea taxonomia
    const config = resolveConfig(aiConfig);
    mods.set(id, {
      m,
      config,
      context: await getRagContext(supabase, id),
      concepts: concepts ?? [],
      minigames: conMinijuegos ? resolveMinigames({ classAllowed: config.allowedMinigames, moduleChosen: m.minigame_types }) : [],
    });
  }
  console.log(`Modulos: ${mods.size} | clasicas por modulo: ${count} | minijuegos: ${conMinijuegos ? 'si' : 'no'} | rondas de reparacion: ${rondas} | juez: perfil ${process.env.AI_PROFILE || 'free'}\n`);

  const resumen: { gen: string; res: ModuleResult[] }[] = [];

  for (const spec of gens) {
    pinGenerator(spec);
    const res: ModuleResult[] = [];
    let fallosGeneracion = 0;
    for (const [, mm] of Array.from(mods.entries())) {
      const t0 = Date.now();
      const conceptBlock = conceptTaxonomyPromptBlock(mm.concepts);
      const classic = Math.min(count, resolveQuestionCount(mm.m.configured_question_count) || count);
      const built = buildGenerationPrompt({ config: mm.config, moduleTitle: mm.m.title, context: mm.context, classicCount: classic, minigames: mm.minigames, conceptBlock });
      const requested = new Set(built.requestedTypes);

      // La cadena de la prueba tiene UN solo candidato: un fallo aislado abria el cortacircuito de la pasarela y los modulos siguientes se saltaban sin
      // intentarlo (all_unavailable). Por eso se reinicia antes de cada intento y se reintenta una vez; los fallos se cuentan y se reportan.
      const generar = async (prompt: string, total: number) => {
        let raw: any[] = [];
        for (let intento = 0; intento < 2 && raw.length === 0; intento++) {
          sharedHealth.reset();
          raw = (await callCohere(prompt, total).catch(() => null)) ?? [];
          if (raw.length === 0) fallosGeneracion++;
        }
        const norm = raw.map(normalizeGeneratedQuestion);
        const { kept } = enforceAllowedTypes(norm, requested);
        return { generadas: raw.length, validas: kept.filter((q: any) => isValidQuestion(q).valid) };
      };

      const filas: Row[] = [];
      const g0 = await generar(built.prompt, built.total);
      let pendientes: any[] = g0.validas.map((q: any, i: number) => ({ ...q, id: `r0-${i}` }));
      let pasanRonda0 = 0;

      for (let ronda = 0; ronda <= rondas; ronda++) {
        if (pendientes.length === 0) break;
        const veredictos = await judgeQuestionsBatch(pendientes, mm.context);
        const noPasan: { q: any; reason: string }[] = [];
        for (const q of pendientes) {
          const v = veredictos.get(q.id);
          const verdict: Verdict = v?.verdict ?? 'sin_veredicto';
          filas.push({ id: q.id, q, verdict, reason: v?.reason ?? '(sin veredicto)', ronda });
          if (verdict !== 'pass') noPasan.push({ q, reason: v?.reason ?? '(sin veredicto)' });
        }
        if (ronda === 0) pasanRonda0 = filas.filter((f) => f.verdict === 'pass').length;
        if (ronda === rondas || noPasan.length === 0) break;

        // REPARACION: se piden preguntas nuevas SOLO para los huecos, diciendole al generador que fallo y por que.
        const mgFaltan = Array.from(new Set(noPasan.filter((x) => mm.minigames.includes(x.q.type)).map((x) => x.q.type as string)));
        const classicFaltan = noPasan.filter((x) => !mm.minigames.includes(x.q.type)).length;
        const b2 = buildGenerationPrompt({ config: mm.config, moduleTitle: mm.m.title, context: mm.context, classicCount: classicFaltan, minigames: mgFaltan, conceptBlock });
        const prompt2 = b2.prompt.replace('\nResponde SOLO con JSON valido:', `\n${repairFeedbackBlock(noPasan)}\n\nResponde SOLO con JSON valido:`);
        const g = await generar(prompt2, b2.total);
        pendientes = g.validas.map((q: any, i: number) => ({ ...q, id: `r${ronda + 1}-${i}` }));
      }

      const r: ModuleResult = {
        modulo: String(mm.m.title).slice(0, 38),
        pedidas: built.total,
        generadas: g0.generadas,
        validas: g0.validas.length,
        pasanRonda0,
        pasanFinal: filas.filter((f) => f.verdict === 'pass').length,
        review: filas.filter((f) => f.verdict === 'review' || f.verdict === 'sin_veredicto').length,
        fail: filas.filter((f) => f.verdict === 'fail').length,
        segundos: Math.round((Date.now() - t0) / 1000),
        filas,
      };
      res.push(r);
      console.log(`  [${spec}] ${r.modulo.padEnd(38)} pedidas ${r.pedidas} | validas ${r.validas} | pasan(1ª) ${r.pasanRonda0} | pasan(final) ${r.pasanFinal} | ${r.segundos}s`);
      if (pausa > 0) await new Promise((r2) => setTimeout(r2, pausa * 1000));
    }
    resumen.push({ gen: spec, res });
    console.log(`  [${spec}] intentos de generacion SIN respuesta legible: ${fallosGeneracion}`);
  }

  console.log('\n=== RESUMEN POR GENERADOR (juez: correccion + segunda opinion de otra familia) ===');
  console.log('Generador'.padEnd(34) + 'pedidas  validas  pasan1ª  tasa1ª   pasanFinal  tasaFinal   review   fail');
  for (const { gen, res } of resumen) {
    const sum = (k: 'pedidas' | 'validas' | 'pasanRonda0' | 'pasanFinal' | 'review' | 'fail') => res.reduce((a, r) => a + r[k], 0);
    const ped = sum('pedidas');
    const validas = sum('validas');
    const p0 = sum('pasanRonda0');
    const pf = sum('pasanFinal');
    console.log(
      `${gen.padEnd(34)}${String(ped).padStart(7)}${String(validas).padStart(9)}${String(p0).padStart(9)}${(((validas ? p0 / validas : 0) * 100).toFixed(0) + '%').padStart(8)}${String(pf).padStart(12)}${(((ped ? pf / ped : 0) * 100).toFixed(0) + '%').padStart(11)}${String(sum('review')).padStart(9)}${String(sum('fail')).padStart(7)}`,
    );
  }
  console.log('\n tasa1ª = de las preguntas validas generadas, cuantas aprueba el juez a la primera. tasaFinal = aprobadas tras las rondas de reparacion / pedidas.');

  // Por que no pasan (primera ronda): categorias aproximadas por palabras clave.
  console.log('\n=== POR QUE NO PASAN (1ª ronda; clasificacion aproximada por palabras clave) ===');
  const cat = (t: string) =>
    /segundo juez/i.test(t) ? 'la segunda opinion no coincide'
    : /video|imagen|texto anterior/i.test(t) ? 'depende de un recurso ausente'
    : /formato|items|elementos|estructura|requiere|incumple/i.test(t) ? 'formato del minijuego'
    : 'contenido incorrecto / ambiguo / no verificable';
  for (const { gen, res } of resumen) {
    const malas = res.flatMap((r) => r.filas).filter((f) => f.ronda === 0 && f.verdict !== 'pass');
    const m = new Map<string, number>();
    for (const f of malas) m.set(cat(f.reason), (m.get(cat(f.reason)) ?? 0) + 1);
    console.log(`  ${gen}: ${malas.length} no pasan -> ${Array.from(m.entries()).map(([k, v]) => `${v} ${k}`).join(' | ') || '—'}`);
  }

  if (guardar) {
    const dir = path.join(process.cwd(), 'evals', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `generacion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify({ fecha: new Date().toISOString(), count, rondas, conMinijuegos, perfil: process.env.AI_PROFILE || 'free', resumen }, null, 2));
    console.log(`\nGuardado en ${path.relative(process.cwd(), file)}`);
  }
}

main().catch((e) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
