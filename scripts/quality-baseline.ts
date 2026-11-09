// LINEA BASE DE CALIDAD de las preguntas generadas (SOLO LECTURA). Mide, con datos reales (sin la clase [CARGA]):
//   - cuantas preguntas hay por estado y quien decidio (juez IA / profesor / sin procedencia);
//   - tasa de aprobacion del juez con intervalo de confianza, por tipo de pregunta y por dia de generacion;
//   - por que se rechazan o se mandan a revision (taxonomia de errores con ORIGEN: generador, pipeline, infraestructura);
//   - acuerdo juez-profesor (ya existe en la tarjeta de revision; aqui se repite para que la linea base sea autocontenida).
//
//   npx tsx --env-file=.env.local scripts/quality-baseline.ts            (imprime)
//   npx tsx --env-file=.env.local scripts/quality-baseline.ts --guardar  (ademas escribe memoria-calidad/baseline-<fecha>.json)
//
// No guarda texto de preguntas ni de materiales: solo conteos, tasas y ids de modulo.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { CATEGORIES, classifyReason, isFormValidatorReason, summarizeErrors } from '../src/lib/aiLearning/errorTaxonomy';
import { wilsonInterval } from '../src/lib/aiLearning/proportion';

const guardar = process.argv.includes('--guardar');
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(1)}%`);
const ci = (s: number, n: number) => {
  const i = wilsonInterval(s, n);
  return i ? `${pct(s / n)} [${pct(i.low)}–${pct(i.high)}] n=${n}` : 'n=0';
};

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: mods, error: me } = await db.from('content_modules').select('id, classrooms(name)');
  if (me) throw new Error(me.message);
  const real = new Set((mods ?? []).filter((m: any) => !String(m.classrooms?.name ?? '').startsWith('[CARGA]')).map((m: any) => m.id));

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('lesson_questions').select('id, module_id, type, review_status, reviewed_by, review_reason, created_at, is_backup').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const q = rows.filter((r) => real.has(r.module_id));

  // Preguntas retiradas por el validador de forma: no son un veredicto de calidad del juez; se cuentan aparte.
  const porForma = q.filter((r) => isFormValidatorReason(r.review_reason));
  const juzgadas = q.filter((r) => !isFormValidatorReason(r.review_reason) && r.review_status !== 'pending');
  const sinJuzgar = q.filter((r) => r.review_status === 'pending').length;

  const aprobadas = juzgadas.filter((r) => r.review_status === 'approved');
  const buenas = aprobadas.length;
  const estados: Record<string, number> = {};
  for (const r of q) estados[`${r.review_status}/${r.reviewed_by ?? 'sin_procedencia'}`] = (estados[`${r.review_status}/${r.reviewed_by ?? 'sin_procedencia'}`] ?? 0) + 1;

  const tipos: Record<string, { n: number; ok: number }> = {};
  for (const r of juzgadas) {
    const t = (tipos[r.type] ??= { n: 0, ok: 0 });
    t.n++;
    if (r.review_status === 'approved') t.ok++;
  }
  const dias: Record<string, { n: number; ok: number }> = {};
  for (const r of juzgadas) {
    const d = String(r.created_at).slice(0, 10);
    const t = (dias[d] ??= { n: 0, ok: 0 });
    t.n++;
    if (r.review_status === 'approved') t.ok++;
  }

  const motivos = juzgadas.filter((r) => r.review_status === 'rejected' || r.review_status === 'human_review').map((r) => r.review_reason);
  const resumen = summarizeErrors(motivos);
  const porTipoError: Record<string, Record<string, number>> = {};
  for (const r of juzgadas.filter((x) => x.review_status === 'rejected' || x.review_status === 'human_review')) {
    const c = classifyReason(r.review_reason);
    ((porTipoError[r.type] ??= {})[c] = (porTipoError[r.type][c] ?? 0) + 1);
  }

  console.log(`Preguntas en clases reales: ${q.length} | retiradas por forma: ${porForma.length} | sin juzgar: ${sinJuzgar} | con veredicto: ${juzgadas.length}`);
  console.log(`Aprobacion del juez (sobre las que tienen veredicto): ${ci(buenas, juzgadas.length)}`);
  console.log('\nEstados/procedencia:', JSON.stringify(estados));
  console.log('\nAprobacion por tipo:');
  for (const [t, v] of Object.entries(tipos).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${t.padEnd(20)} ${ci(v.ok, v.n)}`);
  console.log('\nAprobacion por dia de generacion (solo dias con >= 15 preguntas):');
  for (const [d, v] of Object.entries(dias).sort()) if (v.n >= 15) console.log(`  ${d}  ${ci(v.ok, v.n)}`);
  console.log(`\nMotivos de rechazo o revision: ${resumen.total} | sin clasificar: ${pct(resumen.unclassifiedShare)}`);
  for (const [c, n] of Object.entries(resumen.byCategory).sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(4)}  ${pct(n / resumen.total).padStart(6)}  [${CATEGORIES[c as keyof typeof CATEGORIES].origin}] ${CATEGORIES[c as keyof typeof CATEGORIES].label}`);
  console.log('\nPor origen:', JSON.stringify(resumen.byOrigin));

  if (guardar) {
    const dir = path.join(process.cwd(), 'memoria-calidad');
    fs.mkdirSync(dir, { recursive: true });
    const fecha = new Date().toISOString().slice(0, 10);
    const out = {
      fecha,
      alcance: 'clases reales (sin [CARGA])',
      preguntas: { total: q.length, retiradasPorForma: porForma.length, sinJuzgar, conVeredicto: juzgadas.length, aprobadas: buenas },
      aprobacionJuez: { rate: buenas / juzgadas.length, ci: wilsonInterval(buenas, juzgadas.length) },
      estados,
      porTipo: tipos,
      porDia: Object.fromEntries(Object.entries(dias).filter(([, v]) => v.n >= 15)),
      errores: resumen,
      erroresPorTipo: porTipoError,
    };
    fs.writeFileSync(path.join(dir, `baseline-${fecha}.json`), JSON.stringify(out, null, 2) + '\n');
    console.log(`\nGuardado: memoria-calidad/baseline-${fecha}.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
