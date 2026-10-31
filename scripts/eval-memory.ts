// EVALUACION: ¿la memoria de clase lee bien los apuntes?
//
// Corre el conjunto dorado (src/lib/evals/golden/memoryGolden.ts) con el MODELO REAL (la misma cadena que usa la aplicacion para leer materiales) y mide:
//   - Precision y recall de los conceptos (nodos),
//   - exactitud del perfil detectado (cuantitativo/narrativo),
//   - falsos positivos en las aristas "causa" (y cuantas trampas sin expresion causal quedaron como causa).
// Termina con codigo 1 si alguna compuerta no se cumple.
//
// El conjunto dorado versionado es SINTETICO. Para medir ademas con materiales REALES de una clase (el repositorio es publico: NO los subas), guardalos en
// evals/golden/local/memoria.json (esa carpeta esta en .gitignore) con la misma forma que MemoryGoldenCase y corre con --archivo.
//
// Uso (en TU maquina, con TU .env.local):
//   npx tsx --env-file=.env.local scripts/eval-memory.ts
//   npx tsx --env-file=.env.local scripts/eval-memory.ts --archivo evals/golden/local/memoria.json
//   npx tsx --env-file=.env.local scripts/eval-memory.ts --archivo evals/golden/local/memoria.json --solo-archivo --guardar

import fs from 'fs';
import path from 'path';
import { callStudyModel } from '../src/lib/study/generate';
import { formatReport } from '../src/lib/evals/common';
import { parseMemoryCases, runMemoryEval } from '../src/lib/evals/memoryEval';
import { MEMORY_GOLDEN } from '../src/lib/evals/golden/memoryGolden';

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = arg('--archivo');
const onlyFile = args.includes('--solo-archivo');
const save = args.includes('--guardar');

async function main() {
  const cases = onlyFile ? [] : [...MEMORY_GOLDEN];
  if (file) cases.push(...parseMemoryCases(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))));
  if (cases.length === 0) throw new Error('No hay casos: con --solo-archivo hay que dar --archivo.');

  const report = await runMemoryEval(cases, () => callStudyModel);
  console.log(formatReport(report));

  if (save) {
    const dir = path.join(process.cwd(), 'evals', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `memoria-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(out, JSON.stringify({ fecha: new Date().toISOString(), report }, null, 2));
    console.log(`\nGuardado en ${out}`);
  }
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error('eval-memory fallo:', String(e?.message ?? e));
  process.exit(1);
});
