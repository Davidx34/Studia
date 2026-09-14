// EVALUACION 2/2: ¿el juez IA coincide con el criterio del profesor?
//
// Por que existe: el proyecto no tenia forma de saber si el pipeline mejora.
// Los cambios de los PRs #47, #48, #49, #52 y #53 no se pueden comparar entre
// si -- cada uno se justifico con razonamiento y verificaciones puntuales, no
// con una metrica repetible. Sin esto, toda mejora de IA es un acto de fe.
//
// La verdad de referencia son las filas con reviewed_by='teacher': las unicas
// etiquetas que produjo un humano (migracion 044). El script vuelve a correr
// el juez ACTUAL sobre esas preguntas y compara. Volver a correrlo, en vez de
// leer el veredicto guardado, es deliberado: asi la metrica mide el juez de
// hoy contra el criterio humano, que es justo lo que hace falta para decir
// "esta version es mejor que la anterior".
//
// El error que mas importa NO es el desacuerdo en general, es el FALSO
// APROBADO: el profesor la rechazo y el juez la deja pasar. Esa pregunta llega
// al estudiante. Un falso rechazo solo desperdicia contenido bueno.
//
// Uso:
//   npx tsx --env-file=.env.local scripts/eval-judge.ts
//   npx tsx --env-file=.env.local scripts/eval-judge.ts --limit 24   (cuota de Gemini)
//   npx tsx --env-file=.env.local scripts/eval-judge.ts --guardar    (escribe evals/runs/)
//
// Solo lectura sobre lesson_questions: no modifica ningun review_status.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { judgeQuestionsBatch } from '../src/lib/questions/judge';
import { getRagContext } from '../src/lib/questions/cohereGeneration';

const args = process.argv.slice(2);
const limite = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const guardar = args.includes('--guardar');

type Fila = { humano: 'approved' | 'rejected'; juez: 'pass' | 'fail' | 'review' | null; familia: 'clasica' | 'minijuego'; tipo: string; razon: string };

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: etiquetadas } = await supabase
    .from('lesson_questions')
    .select('id, module_id, type, q, opts, ok, answers, pairs, keywords, exp, game_type, game_data, review_status')
    .eq('reviewed_by', 'teacher')
    .in('review_status', ['approved', 'rejected']);

  if (!etiquetadas?.length) {
    console.log(`
No hay verdad de referencia todavia: 0 preguntas con reviewed_by='teacher'.

Esto NO es un error del script -- es el estado real del proyecto. Los
veredictos que hay en la base los puso el juez IA, no una persona, y hasta la
migracion 044 la base no distinguia entre ambos. Medir el juez contra sus
propios veredictos anteriores no dice nada sobre si acierta.

Para crear la referencia:
  1. Entra a /teacher/classrooms/<id>/review (hay 48 preguntas esperando).
  2. Aprueba o rechaza al menos 30, mezclando clasicas y minijuegos.
     Cada una ahora muestra por que la marco la IA y, si es minijuego, su
     contenido completo -- antes habia que decidir a ciegas.
  3. Vuelve a correr este script.

30 etiquetas dan una senal util; 60 dan una buena.
`);
    return;
  }

  const muestra = etiquetadas.slice(0, limite === Infinity ? etiquetadas.length : limite);
  console.log(`Verdad de referencia: ${etiquetadas.length} preguntas etiquetadas por el profesor.`);
  if (muestra.length < etiquetadas.length) console.log(`Evaluando ${muestra.length} por --limit (cuota de Gemini).`);

  const porModulo = new Map<string, any[]>();
  for (const q of muestra) {
    if (!porModulo.has(q.module_id)) porModulo.set(q.module_id, []);
    porModulo.get(q.module_id)!.push(q);
  }

  const filas: Fila[] = [];
  for (const [moduleId, preguntas] of Array.from(porModulo.entries())) {
    const contexto = await getRagContext(supabase, moduleId);
    const veredictos = await judgeQuestionsBatch(preguntas, contexto);
    for (const q of preguntas) {
      const v = veredictos.get(q.id);
      filas.push({
        humano: q.review_status as 'approved' | 'rejected',
        juez: v?.verdict ?? null,
        familia: q.game_type ? 'minijuego' : 'clasica',
        tipo: q.type,
        razon: v?.reason ?? '(sin veredicto)',
      });
    }
  }

  const conVeredicto = filas.filter((f) => f.juez !== null);
  const cobertura = filas.length > 0 ? conVeredicto.length / filas.length : 0;

  // El juez tiene 3 salidas y el humano 2. "review" no es un error: es el juez
  // diciendo "no me alcanza para decidir", que es su comportamiento correcto
  // ante la duda. Se cuenta aparte, nunca como acierto ni como fallo.
  const aciertos = conVeredicto.filter(
    (f) => (f.juez === 'pass' && f.humano === 'approved') || (f.juez === 'fail' && f.humano === 'rejected')
  );
  const falsosAprobados = conVeredicto.filter((f) => f.juez === 'pass' && f.humano === 'rejected');
  const falsosRechazos = conVeredicto.filter((f) => f.juez === 'fail' && f.humano === 'approved');
  const derivados = conVeredicto.filter((f) => f.juez === 'review');

  const decisivos = conVeredicto.filter((f) => f.juez !== 'review');
  const acuerdo = decisivos.length > 0 ? aciertos.length / decisivos.length : 0;

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log(`
=== Juez IA contra el criterio del profesor ===

Cobertura            ${conVeredicto.length}/${filas.length} preguntas con veredicto (${pct(cobertura)})
Acuerdo              ${aciertos.length}/${decisivos.length} de las decisivas (${pct(acuerdo)})
Derivadas a humano   ${derivados.length}  (el juez dice "no me alcanza" -- no es error)

FALSOS APROBADOS     ${falsosAprobados.length}  <- el peor error: llegan al estudiante
Falsos rechazos      ${falsosRechazos.length}  (desperdician contenido bueno)
`);

  for (const familia of ['clasica', 'minijuego'] as const) {
    const sub = decisivos.filter((f) => f.familia === familia);
    if (sub.length === 0) continue;
    const ok = sub.filter(
      (f) => (f.juez === 'pass' && f.humano === 'approved') || (f.juez === 'fail' && f.humano === 'rejected')
    ).length;
    console.log(`  ${familia.padEnd(10)} acuerdo ${ok}/${sub.length} (${pct(ok / sub.length)})`);
  }

  if (falsosAprobados.length > 0) {
    console.log('\n--- Falsos aprobados (revisar a mano) ---');
    for (const f of falsosAprobados) console.log(`  ${f.tipo}: ${f.razon.slice(0, 120)}`);
  }

  if (guardar) {
    const dir = path.join(process.cwd(), 'evals', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const archivo = path.join(dir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
    fs.writeFileSync(
      archivo,
      JSON.stringify(
        {
          fecha: new Date().toISOString(),
          etiquetasDisponibles: etiquetadas.length,
          evaluadas: filas.length,
          cobertura,
          acuerdo,
          falsosAprobados: falsosAprobados.length,
          falsosRechazos: falsosRechazos.length,
          derivados: derivados.length,
          filas,
        },
        null,
        2
      )
    );
    console.log(`\nCorrida guardada en ${path.relative(process.cwd(), archivo)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
