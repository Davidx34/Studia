#!/usr/bin/env node
// Protocolo 7.1.4: gate de tsc en CI diseñado como "presupuesto" (ratchet)
// en vez de bloqueo duro, a proposito: el protocolo pide explicitamente
// "Solo activar el gate de tsc --noEmit cuando 3.1 este suficientemente
// avanzado como para que no bloquee cada PR trivialmente". El proyecto
// arranca 3.4 con ~577 errores preexistentes (3.1 -- que los baja a 264 --
// aun no esta mergeada a master en el momento de escribir esto). Un gate
// que exige 0 errores rompe CI para siempre desde el primer commit; un
// gate que solo reporta sin fallar nunca detecta regresiones.
//
// Este script corre tsc, cuenta los errores, y compara contra
// TS_ERROR_BUDGET: si el PR aumenta el conteo (introduce un error nuevo,
// deliberado o no), CI falla. Si el conteo baja o se mantiene, CI pasa --
// asi cada PR de limpieza de tipos puede bajar el numero (y debe hacerlo,
// como parte de ese PR) sin que el proyecto entero tenga que llegar a 0
// de una sola vez.

import { execSync } from 'child_process';

// Baseline real de `master` al momento de escribir 3.4 (antes de que 3.1
// -- PR #41 -- se mergee), medido como cantidad de diagnosticos distintos
// ("error TSxxxx" unicos en el output), NO como lineas de output.
//
// Nota: las descripciones de PR anteriores en esta sesion (3.1, 3.2, 3.3)
// citaron "577" como baseline usando `tsc --noEmit | wc -l` -- esa cifra
// cuenta LINEAS de output (los errores multi-linea, como los overloads de
// insert/rpc, inflan el conteo con varias lineas por diagnostico). El
// conteo real de diagnosticos distintos en ese mismo estado es 495. Las
// comparaciones antes/despues de esos PRs siguen siendo validas (usaron
// la misma metrica de ambos lados), pero este script usa la metrica mas
// precisa (conteo de diagnosticos) para el presupuesto de CI en adelante.
// Bajar este numero en cada PR que reduzca errores de tipos; nunca
// subirlo salvo que sea estrictamente necesario y se documente por que.
const TS_ERROR_BUDGET = 495;

console.log(`Corriendo tsc --noEmit (presupuesto actual: ${TS_ERROR_BUDGET} errores)...`);

let output = '';
try {
  execSync('npx tsc --noEmit', { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 });
} catch (err) {
  output = err.stdout || '';
}

const errorCount = (output.match(/error TS\d+/g) || []).length;

console.log(`Errores encontrados: ${errorCount}`);

if (errorCount > TS_ERROR_BUDGET) {
  console.error(
    `\n❌ El conteo de errores de TypeScript subio de ${TS_ERROR_BUDGET} a ${errorCount} (+${errorCount - TS_ERROR_BUDGET}).\n` +
      `Este PR esta introduciendo errores de tipos nuevos. Corrigelos, o si el aumento es intencional\n` +
      `y justificado, sube TS_ERROR_BUDGET en scripts/check-ts-error-budget.mjs explicando por que.\n`
  );
  process.exit(1);
}

if (errorCount < TS_ERROR_BUDGET) {
  console.log(
    `\n✅ Bajaste el conteo de errores de ${TS_ERROR_BUDGET} a ${errorCount} (-${TS_ERROR_BUDGET - errorCount}). ` +
      `Considera actualizar TS_ERROR_BUDGET en este script para no perder el progreso.\n`
  );
} else {
  console.log(`\n✅ Sin regresiones (${errorCount}/${TS_ERROR_BUDGET} del presupuesto).\n`);
}
