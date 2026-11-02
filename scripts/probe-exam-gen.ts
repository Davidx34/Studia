// SONDA de solo LECTURA: ¿que preguntas de examen salen con el material REAL de una clase real? Arma un plan en memoria (una comprension y un modulo que tu escribes), recupera los trozos con la
// busqueda real de la base, genera con los modelos reales (y el juez si hay un proveedor distinto de Cohere) y lo IMPRIME. No guarda nada en la base de datos.
//
// Uso (en TU maquina, con TU .env.local):
//   npx tsx --env-file=.env.local scripts/probe-exam-gen.ts --clase <uuid> --comprension "Calcula la restriccion presupuestaria" --modulo "Restriccion presupuestaria" [--n 5] [--sin-juez]

import { createAdminSupabase, hasServiceRoleKey } from '../src/lib/supabase/admin';
import { callStudyModel } from '../src/lib/study/generate';
import { callJudgeModel, hasJudgeProvider } from '../src/lib/blueprint/examJudgeModel';
import { retrieveExamChunks } from '../src/lib/blueprint/examChunks';
import { generateExamQuestions } from '../src/lib/blueprint/examGenerate';
import type { Blueprint } from '../src/lib/blueprint/types';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

async function main() {
  const classroomId = arg('clase');
  const outcome = arg('comprension');
  const moduleTitle = arg('modulo');
  const n = Number(arg('n') ?? 5);
  const withJudge = !process.argv.includes('--sin-juez') && hasJudgeProvider();
  if (!classroomId || !outcome || !moduleTitle) {
    console.error('Faltan --clase, --comprension o --modulo.');
    process.exit(1);
  }
  if (!hasServiceRoleKey()) {
    console.error('Falta SUPABASE_SERVICE_ROLE_KEY en .env.local.');
    process.exit(1);
  }

  const plan: Blueprint = {
    version: 1,
    outcomes: [{ id: 'o1', statement: outcome }],
    periods: [{ id: 'p1', name: 'Corte', order: 1, weight: 100, assessesOutcomeIds: ['o1'], objectives: [{ id: 'ob1', title: 'Objetivo', outcomeIds: ['o1'], modules: [{ id: 'm1', title: moduleTitle, order: 1 }] }] }],
  };

  const admin: any = createAdminSupabase();
  const chunks = await retrieveExamChunks(admin, { classroomId, query: `${outcome}. ${moduleTitle}` });
  console.log(`\nTrozos recuperados: ${chunks.length}`);
  chunks.forEach((c, i) => console.log(`  [${i + 1}] ${c.materialName} (trozo ${c.chunkIndex}, ${c.text.length} caracteres): ${c.text.replace(/\s+/g, ' ').slice(0, 110)}…`));
  if (chunks.length === 0) {
    console.error('\nNo se recupero material: la clase no tiene material procesado o la busqueda fallo.');
    process.exit(2);
  }

  console.log(`\nGenerando ${n} preguntas${withJudge ? ' con juez de sustento' : ' SIN juez'}…`);
  // Lo que respondio el modelo (para entender un fallo de formato).
  const raws: (string | null)[] = [];
  const model: typeof callStudyModel = async (p) => {
    const out = await callStudyModel(p);
    raws.push(out);
    return out;
  };
  const r = await generateExamQuestions({ plan, outcomeId: 'o1', nodeId: 'm1', chunks, count: n }, model, withJudge ? callJudgeModel : undefined);
  if (!r.ok) {
    console.error(`\nNo se genero (${r.reason}): ${r.message}`);
    if (process.argv.includes('--debug')) raws.forEach((x, i) => console.error(`\n--- respuesta ${i + 1} del modelo (${x?.length ?? 0} caracteres) ---\n${(x ?? '(null)').slice(0, 1500)}`));
    process.exit(3);
  }
  if (process.argv.includes('--debug')) {
    raws.forEach((x, i) => console.log(`\n--- respuesta ${i + 1} del modelo ---\n${(x ?? '(null)').slice(0, 6000)}`));
    chunks.forEach((c, i) => console.log(`\n--- trozo [${i + 1}] (${c.chunkIndex}) texto completo ---\n${c.text}`));
  }
  console.log(`\nValidas: ${r.accepted.length} · rechazadas: ${r.rejected.length} (por el juez: ${r.rejectedByJudge}) · para revision: ${r.needsReview.length} · trozos excluidos: ${r.excludedChunks.length} · llamadas: ${r.modelCalls} + ${r.judgeCalls} del juez`);
  r.accepted.forEach((q, i) => {
    const review = r.needsReview.find((x) => x.question === q);
    console.log(`\n${i + 1}. [${q.type}] ${q.q}${review ? '   ⚠ PARA REVISION' : ''}`);
    if (q.opts) console.log(`   opciones: ${JSON.stringify(q.opts)}  correcta: ${JSON.stringify(q.ok)}`);
    else if (q.type === 'true_false') console.log(`   correcta: ${JSON.stringify(q.ok)}`);
    if (q.answers) console.log(`   respuestas: ${JSON.stringify(q.answers)}`);
    if (q.keywords) console.log(`   palabras clave: ${JSON.stringify(q.keywords)}`);
    if (q.pairs) console.log(`   parejas: ${JSON.stringify(q.pairs)}`);
    console.log(`   explicacion: ${q.exp}`);
    console.log(`   cita: «${q.source.quote}» (trozo ${q.source.chunkIndex})`);
    if (review) console.log(`   juez: ${review.problems.join(' | ')}`);
  });
  if (r.rejected.length > 0) {
    console.log('\nRechazadas:');
    r.rejected.forEach((x) => console.log(`  - ${(x.q ?? '').slice(0, 90)} → ${x.errors[0]?.slice(0, 150)}`));
  }
}

main().catch((e) => {
  console.error('probe-exam-gen fallo:', String(e?.message ?? e));
  process.exit(1);
});
