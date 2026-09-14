// EVALUACION 1/2: calidad del contexto que recibe el generador.
//
// Por que existe: el defecto P0 de la review 360 -- los 8 modulos de una clase
// recibiendo contexto byte a byte identico, con el 2,3% del material y cero
// caracteres del documento de su propio tema -- paso TODOS los controles del
// proyecto. Hay 100+ tests unitarios en verde y un presupuesto de errores de
// TypeScript que baja, pero ninguna medicion end-to-end de si lo que le llega
// al modelo tiene que ver con lo que se le pide generar. Un cambio que empeoro
// el producto no rompio nada porque no habia nada que romper.
//
// Este script es esa medicion. No prueba funciones aisladas: corre getRagContext
// de verdad, contra la base de verdad, y verifica propiedades que deben
// cumplirse siempre. Cada una es falsable y se reporta como PASA/FALLA.
//
// Uso:
//   npx tsx --env-file=.env.local scripts/eval-context.ts --classroom <classroomId>
//   npx tsx --env-file=.env.local scripts/eval-context.ts            (todas las clases)
//   npx tsx --env-file=.env.local scripts/eval-context.ts --json     (salida para guardar)
//
// Solo lectura: no escribe nada en la base.

import { createClient } from '@supabase/supabase-js';
import { getRagContext, RAG_CONTEXT_CHAR_LIMIT } from '../src/lib/questions/cohereGeneration';

type Check = { nombre: string; pasa: boolean; detalle: string };

const args = process.argv.slice(2);
const classroomArg = args.includes('--classroom') ? args[args.indexOf('--classroom') + 1] : null;
const asJson = args.includes('--json');

// Umbrales. Son deliberadamente flojos: la idea no es exigir perfeccion sino
// detectar el colapso. Con el bug del P0, "cobertura" daba 2,3% y "contextos
// distintos" daba 0% -- cualquier umbral razonable los habria atrapado.
const MIN_COBERTURA_MATERIAL = 0.10;   // al menos el 10% de los chunks de la clase se usa en algun modulo
const MIN_LLENADO_CONTEXTO = 0.35;     // el contexto usa al menos el 35% del presupuesto disponible
const MAX_PARES_IDENTICOS = 0.10;      // como mucho el 10% de los pares de modulos comparte contexto exacto

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: classrooms } = classroomArg
    ? await supabase.from('classrooms').select('id, name').eq('id', classroomArg)
    : await supabase.from('classrooms').select('id, name');

  const checks: Check[] = [];
  const resumen: any[] = [];

  for (const aula of classrooms ?? []) {
    const { data: modules } = await supabase
      .from('content_modules')
      .select('id, title')
      .eq('classroom_id', aula.id)
      .order('order_index');

    // Solo modulos que ya tienen preguntas: son los que de verdad se generan.
    const conPreguntas: { id: string; title: string }[] = [];
    for (const m of modules ?? []) {
      const { count } = await supabase
        .from('lesson_questions')
        .select('id', { count: 'exact', head: true })
        .eq('module_id', m.id);
      if ((count ?? 0) > 0) conPreguntas.push(m);
    }
    if (conPreguntas.length < 2) continue;

    const { data: materiales } = await supabase
      .from('teaching_materials')
      .select('id')
      .eq('classroom_id', aula.id)
      .eq('processing_status', 'completed');
    const materialIds = (materiales ?? []).map((m) => m.id);
    const { count: chunksTotales } = await supabase
      .from('material_chunks')
      .select('id', { count: 'exact', head: true })
      .in('material_id', materialIds.length ? materialIds : ['00000000-0000-0000-0000-000000000000']);

    // getRagContext degrada en silencio si generateEmbedding falla (devuelve
    // null ante cualquier error de red): cae al camino por chunk_index y
    // produce un contexto mas pobre. Sin reintento, un hipo puntual de la API
    // de embeddings hace que el evaluador reporte FALLA cuando el pipeline
    // esta bien -- y un evaluador que falla al azar no lo usa nadie. Se
    // reintenta y se avisa, en vez de esconder la inestabilidad.
    const contextos = new Map<string, string>();
    let reintentos = 0;
    for (const m of conPreguntas) {
      let ctx = await getRagContext(supabase, m.id);
      for (let intento = 0; intento < 2 && ctx.length < RAG_CONTEXT_CHAR_LIMIT * MIN_LLENADO_CONTEXTO; intento++) {
        await new Promise((r) => setTimeout(r, 1200));
        const otro = await getRagContext(supabase, m.id);
        reintentos++;
        if (otro.length > ctx.length) ctx = otro;
      }
      contextos.set(m.title, ctx);
    }
    if (reintentos > 0) {
      console.warn(`  aviso [${aula.name}]: ${reintentos} reintento(s) de contexto (posible hipo de la API de embeddings)`);
    }

    // --- Propiedad 1: modulos distintos reciben contexto distinto ---------
    const titulos = Array.from(contextos.keys());
    let identicos = 0;
    let pares = 0;
    for (let i = 0; i < titulos.length; i++) {
      for (let j = i + 1; j < titulos.length; j++) {
        pares++;
        if (contextos.get(titulos[i]) === contextos.get(titulos[j])) identicos++;
      }
    }
    const ratioIdenticos = pares > 0 ? identicos / pares : 0;
    checks.push({
      nombre: `[${aula.name}] modulos distintos reciben contexto distinto`,
      pasa: ratioIdenticos <= MAX_PARES_IDENTICOS,
      detalle: `${identicos}/${pares} pares con contexto identico (${pct(ratioIdenticos)}), tope ${pct(MAX_PARES_IDENTICOS)}`,
    });

    // --- Propiedad 2: el material de la clase se usa, no solo su principio -
    // Aproximacion por cobertura de texto: cuantos chunks de la clase aparecen
    // textualmente en el contexto de ALGUN modulo.
    const { data: todosLosChunks } = await supabase
      .from('material_chunks')
      .select('id, content')
      .in('material_id', materialIds.length ? materialIds : ['00000000-0000-0000-0000-000000000000']);
    const todoElContexto = Array.from(contextos.values()).join('\n');
    const usados = (todosLosChunks ?? []).filter((c) =>
      todoElContexto.includes(c.content.slice(0, 120))
    ).length;
    const cobertura = (chunksTotales ?? 0) > 0 ? usados / (chunksTotales ?? 1) : 0;
    checks.push({
      nombre: `[${aula.name}] el material se usa mas alla de su principio`,
      pasa: cobertura >= MIN_COBERTURA_MATERIAL,
      detalle: `${usados}/${chunksTotales} chunks alcanzados (${pct(cobertura)}), minimo ${pct(MIN_COBERTURA_MATERIAL)}`,
    });

    // --- Propiedad 3: el contexto no desperdicia el presupuesto ------------
    const largos = Array.from(contextos.values()).map((c) => c.length);
    const promedio = largos.reduce((a, b) => a + b, 0) / (largos.length || 1);
    const llenado = promedio / RAG_CONTEXT_CHAR_LIMIT;
    checks.push({
      nombre: `[${aula.name}] el contexto aprovecha el presupuesto disponible`,
      pasa: llenado >= MIN_LLENADO_CONTEXTO,
      detalle: `${Math.round(promedio)} de ${RAG_CONTEXT_CHAR_LIMIT} chars en promedio (${pct(llenado)}), minimo ${pct(MIN_LLENADO_CONTEXTO)}`,
    });

    // --- Propiedad 4: ningun modulo se queda sin contexto ------------------
    const vacios = Array.from(contextos.entries()).filter(([, c]) => c.trim().length < 200);
    checks.push({
      nombre: `[${aula.name}] ningun modulo se genera casi sin contexto`,
      pasa: vacios.length === 0,
      detalle: vacios.length === 0 ? 'todos con contexto' : `sin contexto: ${vacios.map(([t]) => t).join(', ')}`,
    });

    resumen.push({
      clase: aula.name,
      modulos: conPreguntas.length,
      chunksTotales,
      chunksAlcanzados: usados,
      contextoPromedio: Math.round(promedio),
      paresIdenticos: `${identicos}/${pares}`,
    });
  }

  if (asJson) {
    console.log(JSON.stringify({ fecha: new Date().toISOString(), resumen, checks }, null, 2));
  } else {
    console.log('\n=== Calidad del contexto RAG ===\n');
    for (const r of resumen) {
      console.log(`${r.clase}: ${r.modulos} modulos | ${r.chunksAlcanzados}/${r.chunksTotales} chunks alcanzados | ${r.contextoPromedio} chars prom | ${r.paresIdenticos} pares identicos`);
    }
    console.log('');
    for (const c of checks) {
      console.log(`${c.pasa ? 'PASA  ' : 'FALLA '} ${c.nombre}\n         ${c.detalle}`);
    }
  }

  const fallan = checks.filter((c) => !c.pasa).length;
  console.log(`\n${checks.length - fallan}/${checks.length} propiedades se cumplen.`);
  process.exit(fallan > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
