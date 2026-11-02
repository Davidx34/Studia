// EVALUACION: ¿el motor "hacia atras" produce planes de curso utilizables con el MODELO REAL?
//
// Corre el conjunto dorado (src/lib/evals/golden/blueprintGolden.ts) y mide, sin juez humano, la calidad ESTRUCTURAL: plan completo, publicable, decisiones del profesor
// respetadas, sin titulos repetidos, sin cortes vacios y sin obedecer instrucciones escondidas en el borrador. NO mide si los objetivos son pedagogicamente buenos: eso lo lee una
// persona (el informe imprime los planes con --planes). Cuesta 1 + N llamadas a la IA por caso. Termina con codigo 1 si alguna compuerta no se cumple.
//
// Uso (en TU maquina, con TU .env.local):
//   npx tsx --env-file=.env.local scripts/eval-blueprint.ts
//   npx tsx --env-file=.env.local scripts/eval-blueprint.ts --guardar
//   npx tsx --env-file=.env.local scripts/eval-blueprint.ts --planes     (imprime cada plan para leerlo)
//   npx tsx --env-file=.env.local scripts/eval-blueprint.ts --caso borrador-hostil   (solo un caso; para repetir uno sin gastar los demas)

import fs from 'fs';
import path from 'path';
import { callStudyModel } from '../src/lib/study/generate';
import { generateBlueprint } from '../src/lib/blueprint/generate';
import { formatReport } from '../src/lib/evals/common';
import { runBlueprintEval } from '../src/lib/evals/blueprintEval';
import { BLUEPRINT_GOLDEN } from '../src/lib/evals/golden/blueprintGolden';

const save = process.argv.includes('--guardar');
const showPlans = process.argv.includes('--planes');
const onlyIdx = process.argv.indexOf('--caso');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

async function main() {
  const plans: Record<string, unknown> = {};
  // Se guarda lo que genero cada caso para poder LEERLO (la compuerta solo mide estructura).
  const generate: typeof generateBlueprint = async (input, model) => {
    const r = await generateBlueprint(input, model);
    const title = (input as { title?: string })?.title ?? '?';
    plans[title] = r.ok && 'blueprint' in r ? { blueprint: r.blueprint, issues: r.issues } : r;
    return r;
  };
  const report = await runBlueprintEval(only ? BLUEPRINT_GOLDEN.filter((c) => c.id === only) : BLUEPRINT_GOLDEN, () => callStudyModel, { generate });
  console.log(formatReport(report));

  if (showPlans) {
    for (const [title, p] of Object.entries(plans)) {
      const bp = (p as { blueprint?: { outcomes: { statement: string }[]; periods: { name: string; weight: number; assessesOutcomeIds: string[]; objectives: { title: string; modules: { title: string }[] }[] }[] } }).blueprint;
      if (!bp) continue;
      console.log(`\n══ ${title}`);
      bp.outcomes.forEach((o, i) => console.log(`  Comprension ${i + 1}: ${o.statement}`));
      for (const pe of bp.periods) {
        console.log(`  ▸ ${pe.name} (${pe.weight} %) evalua ${pe.assessesOutcomeIds.join(', ')}`);
        for (const ob of pe.objectives) console.log(`      - ${ob.title}: ${ob.modules.map((m) => m.title).join(' | ')}`);
      }
    }
  }
  if (save) {
    const dir = path.join(process.cwd(), 'evals', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `blueprint-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(out, JSON.stringify({ fecha: new Date().toISOString(), report, plans }, null, 2));
    console.log(`\nGuardado en ${out}`);
  }
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error('eval-blueprint fallo:', String(e?.message ?? e));
  process.exit(1);
});
