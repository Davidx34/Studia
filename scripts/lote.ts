// BUCLE ITERATIVO CON JUEZ EXTERNO (docs/IA_ARQUITECTURA_DE_MEMORIAS.md §13). Cuatro pasos; solo `aplicar --db` escribe en la base.
//
//   1. generar          npx tsx --env-file=.env.local scripts/lote.ts generar --modulos 5 --por-modulo 8 [--semilla 1] [--reglas item_writing_v1] [--doctrina]
//        La IA de la app genera EN LOCAL (sin tocar la base), pasa el validador de forma y el juez de la app, y deja el lote en memoria-calidad/lotes/<id>/ (lote.json + lote.md).
//   1b. exportar-banco  npx tsx --env-file=.env.local scripts/lote.ts exportar-banco --n 40 [--estado approved|pending|human_review|todas] [--semilla 1]
//        Lo mismo, pero con preguntas que YA se sirven a los estudiantes (solo lectura): para medir y corregir la calidad del banco real.
//   2. (revision)       El revisor externo lee lote.md, y escribe memoria-calidad/lotes/<id>/revision.json (ver docs §13.2 para el formato).
//   3. resumen          npx tsx --env-file=.env.local scripts/lote.ts resumen <id> [--guardar]
//        Valida la revision de forma ESTRICTA (citas verificables, correcciones validas) y calcula calidad cruda y entregable con IC 95 %. --guardar escribe solo numeros en memoria-calidad/rondas/.
//   3b. comparar        npx tsx --env-file=.env.local scripts/lote.ts comparar <idBase> <idTratamiento>
//        Compara la calidad CRUDA de dos lotes revisados (p. ej. base contra --reglas item_writing_v2, mismos modulos por la misma --semilla) con la estadistica de los experimentos (Wilson/Newcombe).
//   4. aplicar          npx tsx --env-file=.env.local scripts/lote.ts aplicar <id> [--db]
//        Sin --db es un ensayo en seco. Con --db: inserta/corrige en el banco con trazabilidad (ai_question_revisions) y registra la ronda (ai_quality_rounds). Las aprobaciones del revisor externo solo
//        entran como «approved» si el revisor esta VALIDADO frente al profesor; si no, entran como «human_review» (nunca se publica sin validacion). Las preguntas del lote y la revision son PRIVADAS (gitignore).
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
import { RULE_SETS, toPlaybookRules } from '../src/lib/aiLearning/experimentRules';
import { fullText } from '../src/lib/questions/auditor';
import { compareProportions } from '../src/lib/aiLearning/proportion';
import { bankStatusFor, categoryCounts, judgeVsExternal, summarizeRound, validateExternal, validateRevision, type Lot, type LotItem, type Revision } from '../src/lib/aiLearning/externalLoop';

const [cmd, arg1] = process.argv.slice(2);
const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const DIR = path.join(process.cwd(), 'memoria-calidad', 'lotes');
const RONDAS = path.join(process.cwd(), 'memoria-calidad', 'rondas');
const pct = (x: number | null) => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = <T>(xs: T[], r: () => number): T[] => [...xs].sort(() => r() - 0.5);

function writeLot(lot: Lot, contextos: Record<string, string>) {
  const dir = path.join(DIR, lot.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lote.json'), JSON.stringify({ ...lot, contextos }, null, 2) + '\n');
  const md = [`# Lote ${lot.id} (${lot.arm}, generador ${lot.generador}, ${lot.items.length} preguntas)`, '', 'Revisa cada pregunta con el catalogo de defectos del auditor (src/lib/questions/auditor.ts). Escribe revision.json.', ''];
  const byMod = new Map<string, LotItem[]>();
  for (const it of lot.items) byMod.set(it.module_id, [...(byMod.get(it.module_id) ?? []), it]);
  for (const [mid, items] of byMod) {
    md.push(`## Módulo: ${items[0].module_title}`, '', '<details><summary>Material de referencia (recorte)</summary>', '', (contextos[mid] ?? '').slice(0, 3500), '', '</details>', '');
    for (const it of items) md.push(`### ${it.id}${it.judge ? ` — juez de la app: ${it.judge.verdict}${it.judge.reason ? ` (${it.judge.reason.slice(0, 120)})` : ''}` : ''}`, '', '```', fullText(it.question), '```', '');
  }
  fs.writeFileSync(path.join(dir, 'lote.md'), md.join('\n'));
  console.log(`Lote guardado: memoria-calidad/lotes/${lot.id}/lote.md (${lot.items.length} preguntas)`);
}

async function generar() {
  process.env.COHERE_API_KEY = '';
  const gen = val('--gen') ?? 'gemini:gemini-3.5-flash-lite';
  process.env.AI_CHAIN_GENERATION = gen;
  process.env.AI_PROFILE = process.env.AI_PROFILE || 'paid';
  const nMod = Number(val('--modulos') ?? 5);
  const porMod = Number(val('--por-modulo') ?? 8);
  const semilla = Number(val('--semilla') ?? 1);
  const reglas = val('--reglas');
  const doctrina = process.argv.includes('--doctrina');
  if (reglas && !RULE_SETS[reglas]) throw new Error(`Conjunto desconocido: ${reglas}`);
  const d = db();
  const { data: mods } = await d.from('content_modules').select('id, title, classroom_id, classrooms(name)');
  const reales = (mods ?? []).filter((m: any) => !String(m.classrooms?.name ?? '').startsWith('[CARGA]'));
  const elegidos = shuffle(reales, rng(semilla)).slice(0, nMod);
  const id = `${new Date().toISOString().slice(0, 10)}-g${semilla}-${Date.now().toString(36).slice(-4)}`;
  const items: LotItem[] = [];
  const contextos: Record<string, string> = {};
  const ruleBlock = reglas ? playbookPromptBlock(toPlaybookRules(reglas)) : '';
  for (const m of elegidos as any[]) {
    const { data: cfg } = await d.from('classroom_ai_config').select('*').eq('classroom_id', m.classroom_id).maybeSingle();
    const { data: concepts } = await d.from('classroom_concepts').select('tag, label').eq('module_id', m.id);
    const ctx = await getRagContext(d, m.id);
    contextos[m.id] = ctx;
    const built = buildGenerationPrompt({ config: resolveConfig(cfg), moduleTitle: m.title, context: ctx, classicCount: porMod, minigames: [], conceptBlock: conceptTaxonomyPromptBlock(concepts ?? []), playbookBlock: ruleBlock, useDoctrine: doctrina });
    let raw: any[] = [];
    for (let i = 0; i < 2 && raw.length === 0; i++) {
      sharedHealth.reset();
      raw = (await callCohere(built.prompt, built.total).catch(() => null)) ?? [];
    }
    const { kept } = enforceAllowedTypes(raw.map(normalizeGeneratedQuestion), new Set(built.requestedTypes));
    const validas = kept.filter((q: any) => isValidQuestion(q).valid).map((q: any, i: number) => ({ ...q, id: `${id}-${items.length + i + 1}` }));
    const veredictos = validas.length ? await judgeQuestionsBatch(validas, ctx) : new Map();
    for (const q of validas) {
      const { id: qid, ...question } = q;
      const v = veredictos.get(qid);
      items.push({ id: qid, module_id: m.id, module_title: m.title, question, judge: v ? { verdict: v.verdict, reason: v.reason } : null });
    }
    console.log(`  ${String(m.title).slice(0, 40).padEnd(40)} generadas ${raw.length}, validas ${validas.length}`);
  }
  writeLot({ id, fecha: new Date().toISOString(), generador: gen, arm: ['base', reglas ? `reglas:${reglas}` : null, doctrina ? 'doctrina' : null].filter(Boolean).join('+'), items }, contextos);
}

async function exportarBanco() {
  const n = Number(val('--n') ?? 40);
  const estado = val('--estado') ?? 'todas';
  const semilla = Number(val('--semilla') ?? 1);
  const d = db();
  const { data: mods } = await d.from('content_modules').select('id, title, classrooms(name)');
  const reales = new Map((mods ?? []).filter((m: any) => !String(m.classrooms?.name ?? '').startsWith('[CARGA]')).map((m: any) => [m.id as string, m.title as string]));
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await d.from('lesson_questions').select('id, module_id, type, q, opts, ok, exp, answers, keywords, concept_tag, review_status, reviewed_by, review_reason').neq('review_status', 'rejected').range(from, from + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const pool = rows.filter((r) => reales.has(r.module_id) && ['multiple_choice', 'true_false', 'fill_blank', 'short_answer'].includes(r.type) && r.reviewed_by !== 'teacher' && r.reviewed_by !== 'external_ai' && (estado === 'todas' || r.review_status === estado));
  const sel = shuffle(pool, rng(semilla)).slice(0, n);
  const id = `${new Date().toISOString().slice(0, 10)}-b${semilla}-${Date.now().toString(36).slice(-4)}`;
  const contextos: Record<string, string> = {};
  for (const mid of new Set(sel.map((r) => r.module_id))) contextos[mid] = await getRagContext(d, mid).catch(() => '');
  const items: LotItem[] = sel.map((r, i) => {
    const question: any = { type: r.type, q: r.q, exp: r.exp, concept_tag: r.concept_tag };
    for (const k of ['opts', 'ok', 'answers', 'keywords']) if (r[k] !== null && r[k] !== undefined) question[k] = r[k];
    return { id: `${id}-${i + 1}`, module_id: r.module_id, module_title: reales.get(r.module_id)!, question, judge: r.reviewed_by === 'ai_judge' ? { verdict: r.review_status === 'approved' ? 'pass' : r.review_status === 'rejected' ? 'fail' : 'review', reason: r.review_reason ?? '' } : null, bankId: r.id } as LotItem & { bankId: string };
  });
  console.log(`Pool elegible: ${pool.length} | estado: ${estado}`);
  writeLot({ id, fecha: new Date().toISOString(), generador: 'banco', arm: 'banco', items }, contextos);
}

function load(id: string): { lot: Lot & { contextos: Record<string, string> }; rev: Revision } {
  const dir = path.join(DIR, id);
  return { lot: JSON.parse(fs.readFileSync(path.join(dir, 'lote.json'), 'utf8')), rev: JSON.parse(fs.readFileSync(path.join(dir, 'revision.json'), 'utf8')) };
}

function resumen(id: string) {
  const { lot, rev } = load(id);
  const errores = validateRevision(lot, rev);
  if (errores.length) {
    console.log(`REVISION INVALIDA (${errores.length} problemas):`);
    errores.slice(0, 40).forEach((e) => console.log('  - ' + e));
    process.exit(1);
  }
  const s = summarizeRound(rev);
  const kind = lot.arm === 'banco' ? 'bank' : 'generated';
  console.log(`Lote ${id} (${lot.arm}) revisado por ${rev.revisor}: ${s.n} preguntas`);
  console.log(`  veredictos: ${JSON.stringify(s.veredictos)}`);
  console.log(`  CRUDA (buenas tal como salen): ${s.cruda.k}/${s.cruda.n} = ${pct(s.cruda.rate)}  IC95% [${pct(s.cruda.ci?.low ?? null)}, ${pct(s.cruda.ci?.high ?? null)}]  meta 90%: ${s.metaCruda.status}${s.metaCruda.neededN ? ` (haria falta n≈${s.metaCruda.neededN} con esta tasa)` : ''}`);
  console.log(`  ENTREGABLE (buenas + corregidas): ${s.entregable.k}/${s.entregable.n} = ${pct(s.entregable.rate)}  IC95% [${pct(s.entregable.ci?.low ?? null)}, ${pct(s.entregable.ci?.high ?? null)}]`);
  console.log(`  defectos: ${JSON.stringify(s.defectosPorCodigo)}`);
  console.log(`  categorias serias (para reglas): ${JSON.stringify(categoryCounts(s))}`);
  const pares = lot.items.flatMap((it) => {
    const r = rev.items.find((x) => x.id === it.id);
    return it.judge && r ? [{ judge: it.judge.verdict, ext: r.veredicto }] : [];
  });
  if (pares.length) {
    const j = judgeVsExternal(pares);
    console.log(`  JUEZ DE LA APP vs revisor externo: ${j.pairs} pares | el juez aprobo ${j.judgePass}, de las cuales ${j.falsePass} tenian defecto (precision del «pass» ${pct(j.passPrecision.rate)}, IC95% [${pct(j.passPrecision.ci?.low ?? null)}, ${pct(j.passPrecision.ci?.high ?? null)}]) | falsas alarmas ${j.falseAlarm}`);
  }
  if (process.argv.includes('--guardar')) {
    fs.mkdirSync(RONDAS, { recursive: true });
    fs.writeFileSync(path.join(RONDAS, `${id}.json`), JSON.stringify({ lote: id, fecha: new Date().toISOString(), arm: lot.arm, kind, revisor: rev.revisor, resumen: s, juezVsExterno: pares.length ? judgeVsExternal(pares) : null }, null, 2) + '\n');
    console.log(`Guardado (solo numeros): memoria-calidad/rondas/${id}.json`);
  }
}

function comparar(idA: string, idB: string) {
  const a = load(idA);
  const b = load(idB);
  for (const x of [a, b]) {
    const e = validateRevision(x.lot, x.rev);
    if (e.length) throw new Error(`La revision del lote ${x.lot.id} es invalida (${e.length} problemas).`);
  }
  const sa = summarizeRound(a.rev);
  const sb = summarizeRound(b.rev);
  const c = compareProportions({ successes: sa.cruda.k, n: sa.cruda.n }, { successes: sb.cruda.k, n: sb.cruda.n });
  console.log(`Base       (${a.lot.arm}): ${sa.cruda.k}/${sa.cruda.n} buenas = ${pct(sa.cruda.rate)}`);
  console.log(`Tratamiento (${b.lot.arm}): ${sb.cruda.k}/${sb.cruda.n} buenas = ${pct(sb.cruda.rate)}`);
  console.log(`Diferencia: ${c.diff === null ? '-' : (c.diff * 100).toFixed(1) + ' pp'}  IC95% [${pct(c.diffCi?.low ?? null)}, ${pct(c.diffCi?.high ?? null)}]  => ${c.decision.toUpperCase()} (minimo ${c.minPerArm} por lote)`);
  console.log('Recuerda: «sin evidencia» no es «no sirve»; y el revisor externo aun debe estar validado frente al profesor para fiarse de la cifra.');
}

// Pares (revisor externo, profesor) sobre la MISMA pregunta: ultimo veredicto externo (ai_question_revisions) contra la ultima decision del profesor (ai_feedback_events).
async function paresExternoProfesor(d: any) {
  const { data: revs } = await d.from('ai_question_revisions').select('question_id, verdict, created_at').eq('source', 'external_ai').not('question_id', 'is', null).order('created_at', { ascending: true }).limit(20000);
  const ext = new Map<string, string>();
  for (const r of revs ?? []) ext.set(r.question_id, r.verdict);
  const { data: ev } = await d.from('ai_feedback_events').select('question_id, verdict, created_at').eq('signal', 'teacher').order('created_at', { ascending: true }).limit(20000);
  const prof = new Map<string, string>();
  for (const e of ev ?? []) if (e.question_id) prof.set(e.question_id, e.verdict);
  return Array.from(ext.entries()).flatMap(([qid, v]) => {
    const t = prof.get(qid);
    return t === 'approved' || t === 'rejected' ? [{ ext: v as 'bueno' | 'corregir' | 'malo', teacher: t as 'approved' | 'rejected' }] : [];
  });
}

// REGLA ASIMETRICA: el revisor externo SIEMPRE puede retirar una pregunta mala (quitar una pregunta es la direccion segura y reversible), pero APROBAR exige que este validado frente al profesor.
async function aplicar(id: string) {
  const { lot, rev } = load(id);
  const errores = validateRevision(lot, rev);
  if (errores.length) throw new Error(`La revision es invalida (${errores.length} problemas); corrige y vuelve a correr «resumen».`);
  const enDb = process.argv.includes('--db');
  const d = db();
  const validacion = validateExternal(await paresExternoProfesor(d));
  const estado = bankStatusFor(validacion.status);
  console.log(`Revisor externo frente al profesor: ${validacion.pairs} comparaciones (acuerdo ${pct(validacion.agreement.rate)}), estado «${validacion.status}».`);
  console.log(estado === 'approved' ? 'Puede aprobar: sus «bueno» y correcciones entran como aprobadas.' : 'NO puede aprobar todavia: sus «bueno» no cambian el estado, y lo nuevo/corregido entra como «human_review». Si puede RETIRAR las malas.');
  const plan = { retirarDelBanco: 0, corregirEnBanco: 0, aprobarEnBanco: 0, dejarIgualEnBanco: 0, insertarNuevas: 0, descartarNuevas: 0 };
  for (const r of rev.items) {
    const it: any = lot.items.find((x) => x.id === r.id);
    if (it.bankId) {
      if (r.veredicto === 'malo') plan.retirarDelBanco++;
      else if (r.veredicto === 'corregir') plan.corregirEnBanco++;
      else if (estado === 'approved') plan.aprobarEnBanco++;
      else plan.dejarIgualEnBanco++;
    } else if (r.veredicto === 'malo') plan.descartarNuevas++;
    else plan.insertarNuevas++;
  }
  console.log('Plan:', JSON.stringify(plan));
  if (!enDb) return console.log('(ensayo en seco: no se escribio nada. Usa --db para aplicar.)');

  const s = summarizeRound(rev);
  const ahora = new Date().toISOString();
  const camposDe = (q: any) => ({ type: q.type, q: q.q, opts: q.opts ?? null, ok: q.ok ?? null, exp: q.exp ?? null, answers: q.answers ?? null, keywords: q.keywords ?? null, concept_tag: q.concept_tag ?? null });
  let hecho = 0;
  for (const r of rev.items) {
    const it: any = lot.items.find((x) => x.id === r.id);
    const final = r.veredicto === 'corregir' ? r.corregida : it.question;
    const { data: modRow } = await d.from('content_modules').select('classroom_id').eq('id', it.module_id).single();
    let questionId: string | null = it.bankId ?? null;
    if (it.bankId) {
      if (r.veredicto === 'malo') {
        const { error } = await d.from('lesson_questions').update({ review_status: 'rejected', is_backup: true, reviewed_by: 'external_ai', reviewed_at: ahora, review_reason: `[revisor externo] ${r.defectos.map((x) => x.code).join(', ')}`.slice(0, 500) }).eq('id', it.bankId);
        if (error) throw error;
      } else {
        if (r.veredicto === 'corregir') {
          const { error } = await d.from('lesson_questions').update(camposDe(final)).eq('id', it.bankId);
          if (error) throw error;
        }
        if (estado === 'approved') {
          const { error } = await d.from('lesson_questions').update({ review_status: 'approved', reviewed_by: 'external_ai', reviewed_at: ahora, review_reason: r.veredicto === 'corregir' ? '[revisor externo] corregida' : null }).eq('id', it.bankId);
          if (error) throw error;
        }
      }
    } else if (r.veredicto !== 'malo') {
      const { data: nueva, error } = await d.from('lesson_questions').insert({ module_id: it.module_id, ...camposDe(final), is_backup: true, review_status: estado, reviewed_by: 'external_ai', reviewed_at: ahora, review_reason: r.veredicto === 'corregir' ? '[revisor externo] corregida' : null }).select('id').single();
      if (error) throw error;
      questionId = nueva.id;
    }
    const { error: er } = await d.from('ai_question_revisions').insert({ question_id: questionId, classroom_id: modRow?.classroom_id ?? null, source: 'external_ai', verdict: r.veredicto, batch_id: id, before: camposDe(it.question), after: camposDe(final), defects: r.defectos });
    if (er) throw er;
    hecho++;
  }
  const { error: er } = await d.from('ai_quality_rounds').insert({ batch_id: id, source: 'external_ai', kind: lot.arm === 'banco' ? 'bank' : 'generated', n: s.n, good: s.veredictos.bueno, ci_low: s.cruda.ci?.low ?? null, ci_high: s.cruda.ci?.high ?? null, defects: s.defectosPorCodigo, notes: `entregable ${s.entregable.k}/${s.entregable.n}; revisor ${rev.revisor}; estado ${validacion.status}` });
  if (er) throw er;
  console.log(`Aplicadas ${hecho} preguntas y registrada la ronda ${id}.`);
}

(async () => {
  if (cmd === 'generar') await generar();
  else if (cmd === 'exportar-banco') await exportarBanco();
  else if (cmd === 'resumen') resumen(arg1);
  else if (cmd === 'comparar') comparar(arg1, args[2]);
  else if (cmd === 'aplicar') await aplicar(arg1);
  else console.log('Uso: lote.ts generar | exportar-banco | resumen <id> | aplicar <id> [--db]');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
