// EVALUACION: ¿el juez de sustento detecta las preguntas que el material NO respalda, sin rechazar las buenas?
//
// A diferencia de los otros eval, aqui hay RESPUESTA CONOCIDA: src/lib/evals/golden/examJudgeGolden.ts tiene preguntas bien respaldadas y preguntas malas plantadas a proposito
// (dato de mas en la explicacion, respuesta que contradice el material, fecha cambiada, conocimiento externo, generalizacion, terminos confundidos y una ambigua). Usa el modelo REAL del
// juez (tarea `judge` del gateway, SIN Cohere). Cuesta 1 a 2 llamadas por caso. Termina con codigo 1 si alguna compuerta no se cumple.
//
// Uso (en TU maquina, con TU .env.local):
//   npx tsx --env-file=.env.local scripts/eval-exam-judge.ts
//   npx tsx --env-file=.env.local scripts/eval-exam-judge.ts --guardar

import fs from 'fs';
import path from 'path';
import { callJudgeModel, hasJudgeProvider } from '../src/lib/blueprint/examJudgeModel';
import { formatReport } from '../src/lib/evals/common';
import { runExamJudgeEval } from '../src/lib/evals/examJudgeEval';
import { EXAM_JUDGE_GOLDEN } from '../src/lib/evals/golden/examJudgeGolden';

const save = process.argv.includes('--guardar');

async function main() {
  if (!hasJudgeProvider()) {
    console.error('No hay un proveedor para el juez distinto de Cohere (configura GEMINI_API_KEY, GROQ_API_KEY u otro).');
    process.exit(1);
  }
  const report = await runExamJudgeEval(EXAM_JUDGE_GOLDEN, () => callJudgeModel);
  console.log(formatReport(report));
  if (save) {
    const dir = path.join(process.cwd(), 'evals', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `exam-judge-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(file, JSON.stringify({ fecha: new Date().toISOString(), report }, null, 2));
    console.log(`\nGuardado en ${file}`);
  }
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error('eval-exam-judge fallo:', String(e?.message ?? e));
  process.exit(1);
});
