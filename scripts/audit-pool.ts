// Audita con el AUDITOR ESTRICTO una muestra de las preguntas APROBADAS (las que ven los estudiantes) y arma una muestra ciega para el profesor.
//   npx tsx --env-file=.env.local scripts/audit-pool.ts --n 60 [--semilla 7] [--guardar] [--muestra-ciega 40]
// Solo LEE la base. Excluye la clase [CARGA]. La muestra es reproducible (semilla). Con --guardar escribe memoria-calidad/auditorias/<fecha>.json
// y, con --muestra-ciega N, memoria-calidad/auditorias/<fecha>-muestra-ciega.md (para que el profesor decida SIN ver lo que opino el juez ni el auditor)
// y <fecha>-clave.json (la clave: que dijeron el juez y el auditor de cada una; no se la des al profesor antes de que termine).
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { auditQuestions, isAuditable } from '../src/lib/questions/auditor';
import { getRagContext } from '../src/lib/questions/cohereGeneration';
import { wilsonInterval } from '../src/lib/aiLearning/proportion';

const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const N = Number(val('--n') ?? 60);
const semilla = Number(val('--semilla') ?? 7);
const nCiega = Number(val('--muestra-ciega') ?? 0);
const guardar = args.includes('--guardar');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// Generador pseudoaleatorio reproducible (mulberry32).
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

async function main() {
  process.env.AI_PROFILE = process.env.AI_PROFILE || 'paid';
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: mods } = await db.from('content_modules').select('id, title, classrooms(name)');
  const reales = new Map((mods ?? []).filter((m: any) => !String(m.classrooms?.name ?? '').startsWith('[CARGA]')).map((m: any) => [m.id as string, m.title as string]));

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('lesson_questions').select('id, module_id, type, q, opts, ok, exp, answers, keywords, review_status, reviewed_by, review_reason').eq('review_status', 'approved').eq('is_backup', false).range(from, from + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const pool = rows.filter((r) => reales.has(r.module_id) && isAuditable(r));
  console.log(`Preguntas aprobadas y auditables (clases reales): ${pool.length}`);

  const r = rng(semilla);
  const muestra = [...pool].sort(() => r() - 0.5).slice(0, Math.max(N, nCiega));
  const aAuditar = muestra; // la muestra ciega tambien se audita, para tener la clave completa

  const porModulo = new Map<string, any[]>();
  for (const q of aAuditar) porModulo.set(q.module_id, [...(porModulo.get(q.module_id) ?? []), q]);
  const resultados = new Map<string, Awaited<ReturnType<typeof auditQuestions>> extends Map<string, infer V> ? V : never>();
  for (const [moduleId, qs] of porModulo) {
    const ctx = await getRagContext(db, moduleId).catch(() => '');
    const res = await auditQuestions(qs, ctx);
    res.forEach((v, k) => resultados.set(k, v));
    console.log(`  ${reales.get(moduleId)!.slice(0, 40).padEnd(40)} ${qs.length} preguntas`);
  }

  const auditadas = aAuditar.filter((q) => resultados.get(q.id)?.audited);
  const sospechosas = auditadas.filter((q) => resultados.get(q.id)!.suspicious);
  const ciegas = auditadas.filter((q) => resultados.get(q.id)!.blindApplicable && resultados.get(q.id)!.blindMatches !== null);
  const discrepan = ciegas.filter((q) => resultados.get(q.id)!.blindMatches === false);
  const wi = wilsonInterval(sospechosas.length, auditadas.length);
  console.log(`\n=== AUDITORIA ESTRICTA ===`);
  console.log(`Auditadas ${auditadas.length} de ${aAuditar.length} (el resto: el auditor no respondio, no cuenta)`);
  console.log(`Sospechosas: ${sospechosas.length} (${pct(auditadas.length ? sospechosas.length / auditadas.length : 0)})  IC95% [${pct(wi?.low ?? 0)}, ${pct(wi?.high ?? 0)}]`);
  console.log(`Resolucion ciega discrepa: ${discrepan.length} de ${ciegas.length}`);
  for (const q of sospechosas.slice(0, 25)) console.log(`  - [${q.type}] ${String(q.q).slice(0, 90)}\n      ${resultados.get(q.id)!.reasons.join(' | ').slice(0, 260)}`);

  if (guardar) {
    const dir = path.join(process.cwd(), 'memoria-calidad', 'auditorias');
    fs.mkdirSync(dir, { recursive: true });
    const fecha = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(dir, `${fecha}.json`),
      JSON.stringify(
        { fecha: new Date().toISOString(), semilla, poolAuditable: pool.length, auditadas: auditadas.length, sospechosas: sospechosas.length, ic95: wi, resolucionCiega: { evaluables: ciegas.length, discrepan: discrepan.length }, detalle: aAuditar.map((q) => ({ id: q.id, tipo: q.type, revisadaPor: q.reviewed_by, ...(resultados.get(q.id) ?? {}) })) },
        null,
        2,
      ) + '\n',
    );
    console.log(`Guardado: memoria-calidad/auditorias/${fecha}.json`);

    if (nCiega > 0) {
      const sel = muestra.slice(0, nCiega);
      const md = [`# Muestra ciega para el profesor (${fecha})`, '', 'Para cada pregunta marca: **A** (la usarías tal cual), **R** (hay que corregirla) o **X** (descartarla), y anota por qué si es R o X. No se muestra qué opinaron el juez ni el auditor.', ''];
      sel.forEach((q, i) => {
        md.push(`## ${i + 1}. [${q.type}] ${reales.get(q.module_id)}`, '', String(q.q), '');
        if (Array.isArray(q.opts)) q.opts.forEach((o: string, j: number) => md.push(`- ${String.fromCharCode(65 + j)}) ${o}${q.ok === j ? '  ← respuesta marcada' : ''}`));
        else if (q.type === 'true_false') md.push(`- Respuesta marcada: ${q.ok ? 'Verdadero' : 'Falso'}`);
        else if (q.answers) md.push(`- Respuestas aceptadas: ${JSON.stringify(q.answers)}`);
        if (q.exp) md.push('', `Explicación: ${q.exp}`);
        md.push('', 'Decisión (A / R / X): ____   Motivo: ____', '');
      });
      fs.writeFileSync(path.join(dir, `${fecha}-muestra-ciega.md`), md.join('\n'));
      fs.writeFileSync(path.join(dir, `${fecha}-clave.json`), JSON.stringify(sel.map((q, i) => ({ n: i + 1, id: q.id, revisadaPor: q.reviewed_by, motivoJuez: q.review_reason, auditor: resultados.get(q.id) ?? null })), null, 2) + '\n');
      console.log(`Muestra ciega (${sel.length}) y clave guardadas. La clave NO se comparte con el profesor hasta que termine.`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
