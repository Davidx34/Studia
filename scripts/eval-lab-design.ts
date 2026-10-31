// EVALUACION: ¿el diseñador de laboratorios es confiable de extremo a extremo?
//
// Corre el conjunto dorado (src/lib/evals/golden/labDesignGolden.ts) con el MODELO REAL y mide:
//   - si clasifica bien la suficiencia de los materiales (sufficient | partial | insufficient),
//   - que NUNCA entregue un laboratorio cuando faltan los materiales esenciales,
//   - que toda ficha aceptada pase la validacion completa (numerica) y que sus formulas no contradigan los apuntes.
// Termina con codigo 1 si alguna compuerta no se cumple.
//
// Uso (en TU maquina, con TU .env.local):
//   npx tsx --env-file=.env.local scripts/eval-lab-design.ts
//   npx tsx --env-file=.env.local scripts/eval-lab-design.ts --guardar

import fs from 'fs';
import path from 'path';
import { callStudyModel } from '../src/lib/study/generate';
import { formatReport } from '../src/lib/evals/common';
import { runLabDesignEval } from '../src/lib/evals/labDesignEval';
import { LAB_GOLDEN } from '../src/lib/evals/golden/labDesignGolden';

const save = process.argv.includes('--guardar');

async function main() {
  const report = await runLabDesignEval(LAB_GOLDEN, () => callStudyModel);
  console.log(formatReport(report));

  if (save) {
    const dir = path.join(process.cwd(), 'evals', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `lab-design-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(out, JSON.stringify({ fecha: new Date().toISOString(), report }, null, 2));
    console.log(`\nGuardado en ${out}`);
  }
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error('eval-lab-design fallo:', String(e?.message ?? e));
  process.exit(1);
});
