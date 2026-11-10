// EXPERIMENTO A/B DE GENERACION (no escribe preguntas en la base): ¿un cambio REDUCE los errores del generador?
// Un brazo BASE (A: como genera hoy) y uno o dos TRATAMIENTOS comparados contra la misma base:
//   R = reglas candidatas en el prompt (--reglas <conjunto>, el mismo bloque que leeria un cuaderno activo)
//   D = doctrina pedagogica global (--doctrina)
// MISMOS modulos, MISMO contexto, MISMO juez; en cada (modulo, repeticion) se corren TODOS los brazos juntos (A, R, D) para que los cambios de carga o cuota del proveedor los afecten por igual. La decision usa el
// intervalo de confianza de la diferencia (proportion.ts): solo se dice «mejora» si queda ENTERO del lado bueno y hay muestra minima; «sin evidencia» NO significa «no sirve», significa «mide mas».
//
//   npx tsx --env-file=.env.local scripts/ab-generation.ts --reglas item_writing_v1 --doctrina --peores 5 --reps 2 --guardar
//
// Exito = la pregunta pasa el juez. Los veredictos «review» por INFRAESTRUCTURA (segunda opinion no disponible, cuota) se excluyen del denominador de TODOS los brazos: no son culpa del generador.
// Fiabilidad de generacion: una respuesta ilegible (JSON roto) se REINTENTA una vez y se CUENTA contra el brazo (no se esconde descartando el par): un tratamiento que rompe el formato es un resultado, no ruido.
// Si fallan 3 grupos seguidos (cuota o credito agotado, proveedor caido) el experimento se DETIENE y queda marcado incompleto. Solo cuentan los grupos COMPLETOS (todos los brazos respondieron).
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
import { DOCTRINE_VERSION } from '../src/lib/aiLearning/doctrine';

const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const reglas = val('--reglas');
const doctrina = args.includes('--doctrina');
const nModulos = Number(val('--modulos') ?? 4);
const reps = Number(val('--reps') ?? 2);
const count = Number(val('--count') ?? 8);
const pausa = Number(val('--pausa') ?? 6);
const gen = val('--gen') ?? 'gemini:gemini-3.5-flash-lite';
const guardar = args.includes('--guardar');
// --peores N: usa los N modulos con MENOR aprobacion historica del juez (con al menos 15 preguntas juzgadas): donde hay margen para mejorar, para evitar el efecto techo.
const peores = Number(val('--peores') ?? 0);
const MAX_GRUPOS_FALLIDOS_SEGUIDOS = 3;
const pct = (x: number | null) => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);

if (!reglas && !doctrina) {
  console.error('Indica --reglas <conjunto> y/o --doctrina (los tratamientos a comparar con la base).');
  process.exit(1);
}
if (reglas && !RULE_SETS[reglas]) {
  console.error(`Conjunto desconocido: ${reglas}. Disponibles: ${ruleSetNames().join(', ')}`);
  process.exit(1);
}

type ArmId = 'A' | 'R' | 'D';
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
interface Reliability {
  llamadas: number;
  ok: number;
}
const newStats = (): ArmStats => ({ pedidas: 0, generadas: 0, validasForma: 0, pass: 0, fail: 0, reviewGenerador: 0, excluidasInfra: 0, porCategoria: {} });

const NAME: Record<ArmId, string> = { A: 'base', R: `reglas:${reglas}`, D: `doctrina:${DOCTRINE_VERSION}` };

async function main() {
  // Un solo candidato en la cadena de generacion (igual que eval-generation): el brazo no depende de otro proveedor.
  process.env.COHERE_API_KEY = '';
  process.env.AI_CHAIN_GENERATION = gen;
  process.env.AI_PROFILE = process.env.AI_PROFILE || 'paid';

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: rev } = await db.from('lesson_questions').select('module_id').eq('reviewed_by', 'teacher');
  let ids: string[];
  if (val('--ids')) ids = val('--ids')!.split(',');
  else if (peores > 0) {
    const { data: mm } = await db.from('content_modules').select('id, classrooms(name)');
    const reales = new Set((mm ?? []).filter((m: any) => !String(m.classrooms?.name ?? '').startsWith('[CARGA]')).map((m: any) => m.id));
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from('lesson_questions').select('module_id, review_status, review_reason').neq('review_status', 'pending').range(from, from + 999);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const por = new Map<string, { n: number; ok: number }>();
    for (const r of rows) {
      if (!reales.has(r.module_id) || String(r.review_reason ?? '').startsWith('[validador de forma]')) continue;
      const t = por.get(r.module_id) ?? { n: 0, ok: 0 };
      t.n++;
      if (r.review_status === 'approved') t.ok++;
      por.set(r.module_id, t);
    }
    ids = Array.from(por.entries()).filter(([, t]) => t.n >= 15).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).slice(0, peores).map(([id]) => id);
    console.log('Modulos elegidos por menor aprobacion historica: ' + ids.map((id) => `${id.slice(0, 4)} (${Math.round((100 * por.get(id)!.ok) / por.get(id)!.n)}% de ${por.get(id)!.n})`).join(', '));
  } else ids = Array.from(new Set((rev ?? []).map((r: any) => r.module_id as string))).slice(0, nModulos);
  if (ids.length === 0) return console.log('No hay modulos candidatos. Usa --ids <id,id>.');

  const mods: { id: string; title: string; config: any; context: string; conceptBlock: string }[] = [];
  for (const id of ids) {
    const { data: m } = await db.from('content_modules').select('id, classroom_id, title').eq('id', id).single();
    if (!m) continue;
    const { data: cfg } = await db.from('classroom_ai_config').select('*').eq('classroom_id', m.classroom_id).maybeSingle();
    const { data: concepts } = await db.from('classroom_concepts').select('tag, label').eq('module_id', id);
    mods.push({ id, title: m.title, config: resolveConfig(cfg), context: await getRagContext(db, id), conceptBlock: conceptTaxonomyPromptBlock(concepts ?? []) });
  }
  const ruleBlock = reglas ? playbookPromptBlock(toPlaybookRules(reglas)) : '';
  const arms: ArmId[] = ['A', ...(reglas ? (['R'] as ArmId[]) : []), ...(doctrina ? (['D'] as ArmId[]) : [])];
  console.log(`Experimento: brazos ${arms.map((a) => `${a}=${NAME[a]}`).join(' | ')} | modulos: ${mods.length} | repeticiones: ${reps} | preguntas por llamada: ${count} (sin minijuegos) | generador: ${gen}\n`);

  const stats = Object.fromEntries(arms.map((a) => [a, newStats()])) as Record<ArmId, ArmStats>;
  const rel = Object.fromEntries(arms.map((a) => [a, { llamadas: 0, ok: 0 }])) as Record<ArmId, Reliability>;
  let gruposCompletos = 0;
  let gruposDescartados = 0;
  let seguidos = 0;
  let abortado: string | null = null;

  // Genera con UN reintento si la respuesta es ilegible; cada intento cuenta en la fiabilidad del brazo.
  const generar = async (arm: ArmId, mm: (typeof mods)[number]) => {
    const built = buildGenerationPrompt({
      config: mm.config,
      moduleTitle: mm.title,
      context: mm.context,
      classicCount: count,
      minigames: [],
      conceptBlock: mm.conceptBlock,
      playbookBlock: arm === 'R' ? ruleBlock : '',
      useDoctrine: arm === 'D',
    });
    for (let intento = 0; intento < 2; intento++) {
      sharedHealth.reset();
      rel[arm].llamadas++;
      const raw = (await callCohere(built.prompt, built.total).catch(() => null)) ?? [];
      if (raw.length > 0) {
        rel[arm].ok++;
        return { built, raw };
      }
    }
    return null;
  };

  const evaluar = async (arm: ArmId, mm: (typeof mods)[number], rep: number, g: { built: ReturnType<typeof buildGenerationPrompt>; raw: any[] }): Promise<ArmStats> => {
    const s = newStats();
    s.pedidas = g.built.total;
    s.generadas = g.raw.length;
    const { kept } = enforceAllowedTypes(g.raw.map(normalizeGeneratedQuestion), new Set(g.built.requestedTypes));
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
      const gens = new Map<ArmId, Awaited<ReturnType<typeof generar>>>();
      for (const a of arms) gens.set(a, await generar(a, mm));
      const faltan = arms.filter((a) => !gens.get(a));
      if (faltan.length > 0) {
        gruposDescartados++;
        seguidos++;
        console.log(`  rep ${rep + 1} ${mm.title.slice(0, 34).padEnd(34)} GRUPO DESCARTADO (sin respuesta tras reintento: ${faltan.join(', ')}) | seguidos ${seguidos}`);
        if (seguidos >= MAX_GRUPOS_FALLIDOS_SEGUIDOS) {
          abortado = `${MAX_GRUPOS_FALLIDOS_SEGUIDOS} grupos seguidos sin respuesta de la generacion (cuota o credito agotado, o proveedor caido)`;
          break outer;
        }
        continue;
      }
      seguidos = 0;
      // El ORDEN de juicio rota en cada grupo: el segundo juez (proveedores gratuitos con limite por minuto) se agota hacia el final de cada tanda, y con un orden fijo esa degradacion
      // (preguntas excluidas por infraestructura) caeria siempre en los mismos brazos y sesgaria la comparacion (visto en el experimento del 2026-11-10: base 0, reglas 11, doctrina 13).
      const giro = (gruposCompletos + gruposDescartados) % arms.length;
      for (const a of [...arms.slice(giro), ...arms.slice(0, giro)]) add(stats[a], await evaluar(a, mm, rep, gens.get(a)!));
      gruposCompletos++;
      console.log(`  rep ${rep + 1} ${mm.title.slice(0, 34).padEnd(34)} grupo ok | ${arms.map((a) => `${a}: pass ${stats[a].pass} fail ${stats[a].fail} rev ${stats[a].reviewGenerador} infra ${stats[a].excluidasInfra}`).join(' | ')}`);
      if (pausa > 0) await new Promise((r) => setTimeout(r, pausa * 1000));
    }
  }
  if (abortado) console.log(`\n*** EXPERIMENTO INTERRUMPIDO: ${abortado}. Se cuentan solo los grupos completos (${gruposCompletos}); el resultado es INCOMPLETO. ***`);

  const n = (s: ArmStats) => s.pass + s.fail + s.reviewGenerador; // denominador: con veredicto atribuible al generador
  const comparaciones: Record<string, unknown> = {};
  console.log('\n=== RESULTADO ===');
  for (const a of arms) {
    const s = stats[a];
    console.log(`Brazo ${a} (${NAME[a]}): generadas ${s.generadas} | validas de forma ${s.validasForma} | con veredicto ${n(s)} | pasan ${s.pass} (${pct(n(s) ? s.pass / n(s) : null)}) | excluidas por infraestructura ${s.excluidasInfra} | generacion legible ${rel[a].ok}/${rel[a].llamadas} llamadas`);
    console.log(`   errores: ${JSON.stringify(s.porCategoria)}`);
  }
  for (const t of arms.filter((x) => x !== 'A')) {
    const cp = compareProportions({ successes: stats.A.pass, n: n(stats.A) }, { successes: stats[t].pass, n: n(stats[t]) });
    const cf = compareProportions({ successes: stats.A.validasForma, n: stats.A.generadas }, { successes: stats[t].validasForma, n: stats[t].generadas });
    const cr = compareProportions({ successes: rel.A.ok, n: rel.A.llamadas }, { successes: rel[t].ok, n: rel[t].llamadas });
    comparaciones[t] = { pasanJuez: cp, formaValida: cf, generacionLegible: cr };
    console.log(`\n${t} (${NAME[t]}) contra la base:`);
    console.log(`  Pasan el juez:       diferencia ${cp.diff === null ? '-' : (cp.diff * 100).toFixed(1) + ' pp'}  IC95% [${pct(cp.diffCi?.low ?? null)}, ${pct(cp.diffCi?.high ?? null)}]  => ${cp.decision.toUpperCase()}`);
    console.log(`  Validas de forma:    diferencia ${cf.diff === null ? '-' : (cf.diff * 100).toFixed(1) + ' pp'}  => ${cf.decision.toUpperCase()}`);
    console.log(`  Generacion legible:  diferencia ${cr.diff === null ? '-' : (cr.diff * 100).toFixed(1) + ' pp'}  => ${cr.decision.toUpperCase()}`);
  }
  console.log(`\nGrupos completos: ${gruposCompletos} | descartados: ${gruposDescartados} | previstos: ${reps * mods.length}`);

  if (guardar) {
    const dir = path.join(process.cwd(), 'memoria-calidad', 'experimentos');
    fs.mkdirSync(dir, { recursive: true });
    const nombre = ['base', reglas, doctrina ? 'doctrina' : null].filter(Boolean).join('+');
    const id = `${new Date().toISOString().slice(0, 10)}-${nombre}`;
    const incompleto = !!abortado || gruposCompletos < reps * mods.length;
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify(
        { id, fecha: new Date().toISOString(), brazos: arms.map((a) => ({ id: a, nombre: NAME[a] })), reglas: reglas ?? null, bloqueReglas: ruleBlock || null, doctrina, doctrinaVersion: doctrina ? DOCTRINE_VERSION : null, generador: gen, modulos: mods.length, repeticiones: reps, preguntasPorLlamada: count, estadisticas: stats, fiabilidadGeneracion: rel, comparaciones, gruposCompletos, gruposDescartados, gruposPrevistos: reps * mods.length, incompleto, motivoIncompleto: abortado },
        null,
        2,
      ) + '\n',
    );
    console.log(`Guardado: memoria-calidad/experimentos/${id}.json${incompleto ? '  (INCOMPLETO)' : ''}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
