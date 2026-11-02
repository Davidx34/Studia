// EVALUACION: ¿el generador de preguntas de examen produce preguntas VALIDAS con el MODELO REAL?
//
// Corre el conjunto dorado (src/lib/evals/golden/examGenGolden.ts: material de ejemplo de tres materias, un caso de material escaso y uno con una orden escondida) y mide cuantas
// preguntas sobreviven a la validacion (explicacion de fondo, auto-calificacion y cita textual comprobada contra el material). NO mide si cada pregunta es buena pedagogicamente: eso lo
// lee una persona (--preguntas imprime las aceptadas). Cuesta 1 a 2 llamadas a la IA por caso. Termina con codigo 1 si alguna compuerta no se cumple.
//
// Uso (en TU maquina, con TU .env.local):
//   npx tsx --env-file=.env.local scripts/eval-exam-gen.ts
//   npx tsx --env-file=.env.local scripts/eval-exam-gen.ts --guardar
//   npx tsx --env-file=.env.local scripts/eval-exam-gen.ts --preguntas     (imprime las preguntas aceptadas para leerlas)

import fs from 'fs';
import path from 'path';
import { callStudyModel } from '../src/lib/study/generate';
import { generateExamQuestions } from '../src/lib/blueprint/examGenerate';
import { formatReport } from '../src/lib/evals/common';
import { runExamGenEval } from '../src/lib/evals/examGenEval';
import { EXAM_GEN_GOLDEN } from '../src/lib/evals/golden/examGenGolden';

const save = process.argv.includes('--guardar');
const showQuestions = process.argv.includes('--preguntas');

async function main() {
  const out: Record<string, unknown> = {};
  let current = '';
  const generate: typeof generateExamQuestions = async (input, model) => {
    const r = await generateExamQuestions(input, model);
    out[current] = r;
    return r;
  };
  // El generador recibe el caso; se anota cual es para guardar lo que produjo.
  const report = await runExamGenEval(EXAM_GEN_GOLDEN, (c) => {
    current = c.id;
    return callStudyModel;
  }, { generate });
  console.log(formatReport(report));

  if (showQuestions) {
    for (const [id, r] of Object.entries(out)) {
      const res = r as { ok: boolean; accepted?: { type: string; q: string; opts?: unknown; ok?: unknown; answers?: unknown; keywords?: unknown; pairs?: unknown; exp: string; source: { quote: string } }[] };
      if (!res.ok || !res.accepted) continue;
      console.log(`\n══ ${id}`);
      res.accepted.forEach((q, i) => {
        console.log(`  ${i + 1}. [${q.type}] ${q.q}`);
        if (q.type === 'true_false') console.log(`     correcta: ${JSON.stringify(q.ok)}`);
        if (q.pairs) console.log(`     parejas: ${JSON.stringify(q.pairs)}`);
        if (q.opts) console.log(`     opciones: ${JSON.stringify(q.opts)} correcta: ${JSON.stringify(q.ok)}`);
        if (q.answers) console.log(`     respuestas: ${JSON.stringify(q.answers)}`);
        if (q.keywords) console.log(`     palabras clave: ${JSON.stringify(q.keywords)}`);
        console.log(`     explicacion: ${q.exp}`);
        console.log(`     cita: «${q.source.quote}»`);
      });
    }
  }
  if (save) {
    const dir = path.join(process.cwd(), 'evals', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `exam-gen-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(file, JSON.stringify({ fecha: new Date().toISOString(), report, resultados: out }, null, 2));
    console.log(`\nGuardado en ${file}`);
  }
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error('eval-exam-gen fallo:', String(e?.message ?? e));
  process.exit(1);
});
