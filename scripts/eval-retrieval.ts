// EVALUACION 3: ¿la recuperacion encuentra el fragmento correcto?
//
// Complementa eval-context.ts (que mide propiedades estructurales: cobertura, relleno, contextos repetidos). Este mide
// RELEVANCIA con una verdad conocida: para una muestra de fragmentos, un modelo escribe (a) una pregunta de estudio que SOLO
// ese fragmento responde (parafraseada) y (b) un "tema" corto como titulo de modulo; luego se comprueba en que puesto devuelve cada estrategia ese
// fragmento. Metricas: Hit@1 / Hit@3 / Hit@5 y MRR@10.
//
// Estrategias comparadas:
//   vector_legacy  embedding de la consulta SIN taskType y sin normalizar (como funcionaba antes), solo vector
//   vector_typed   embedding RETRIEVAL_QUERY normalizado, solo vector
//   text           solo texto completo en español (no usa embeddings: mide la red de seguridad)
//   hybrid         vector + texto fusionados con RRF (lo que usa produccion)
//
// Las preguntas se generan con la pasarela de IA (necesita al menos una llave de la cadena "analysis"). La muestra es
// reproducible con --seed. Solo lectura: no escribe nada en la base.
//
// Uso (en TU maquina, con TU .env.local):
//   npx tsx --env-file=.env.local scripts/eval-retrieval.ts
//   npx tsx --env-file=.env.local scripts/eval-retrieval.ts --classroom <id> --n 40 --seed 7 --guardar

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { embedWithGemini, embedQuery, LEGACY_EMBEDDING_PROFILE, QUERYABLE_PROFILES } from '../src/lib/embeddings/embed';
import { routeText, describeAttempts } from '../src/lib/ai/gateway';

const args = process.argv.slice(2);
const arg = (name: string, def?: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const classroomArg = arg('--classroom');
const N = Number(arg('--n', '40'));
const seed = Number(arg('--seed', '1'));
const save = args.includes('--guardar');

// Generador pseudoaleatorio reproducible (mulberry32).
function rng(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Strategy = 'vector_legacy' | 'vector_typed' | 'text' | 'hybrid';
const STRATEGIES: Strategy[] = ['vector_legacy', 'vector_typed', 'text', 'hybrid'];

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan variables de Supabase en .env.local');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: classrooms } = classroomArg ? await supabase.from('classrooms').select('id, name').eq('id', classroomArg) : await supabase.from('classrooms').select('id, name');
  const report: any[] = [];

  for (const aula of classrooms ?? []) {
    const { data: mats } = await supabase.from('teaching_materials').select('id').eq('classroom_id', aula.id).eq('processing_status', 'completed');
    const ids = (mats ?? []).map((m) => m.id);
    if (ids.length === 0) continue;
    const { data: chunks } = await supabase.from('material_chunks').select('id, content, embedding_model').in('material_id', ids).not('embedding', 'is', null);
    const pool = (chunks ?? []).filter((c) => c.content.length > 400);
    if (pool.length < 5) continue;

    const r = rng(seed);
    const sample = [...pool].sort(() => r() - 0.5).slice(0, Math.min(N, pool.length));
    const perfiles: Record<string, number> = {};
    for (const c of chunks ?? []) perfiles[c.embedding_model ?? '(sin perfil)'] = (perfiles[c.embedding_model ?? '(sin perfil)'] ?? 0) + 1;

    console.log(`\n=== ${aula.name} — ${sample.length} consultas de ${pool.length} fragmentos ===`);
    console.log('  perfiles de embedding:', JSON.stringify(perfiles));

    // 1. Por fragmento, DOS consultas con verdad conocida (el fragmento que las responde):
    //    - "pregunta": una pregunta de estudio PARAFRASEADA (poco solape de palabras: el caso mas dificil para el texto).
    //    - "tema": 5-10 palabras como un titulo de modulo, con los terminos tecnicos del fragmento (lo que de verdad se
    //      busca en produccion: titulo + palabras clave del modulo).
    type Q = { chunk: string; kind: 'pregunta' | 'tema'; text: string };
    const queries: Q[] = [];
    let failures = 0;
    let lastWhy = '';
    for (const c of sample) {
      const res = await routeText<{ question: string; topic: string }>({
        task: 'analysis',
        json: true,
        // Los modelos gpt-oss "piensan" antes de responder y ese razonamiento cuenta como salida: con pocos tokens la
        // respuesta llega vacia. Presupuesto holgado.
        maxTokens: 2000,
        prompt: `Lee el fragmento y devuelve DOS cosas en español, solo JSON: {"question":"...","topic":"..."}
- "question": UNA pregunta de estudio que solo ese fragmento pueda responder. Parafrasea: NO copies frases literales ni uses nombres de seccion.
- "topic": entre 5 y 10 palabras, como el titulo de un modulo de clase sobre lo que trata el fragmento, con sus terminos tecnicos principales.

FRAGMENTO:
${c.content.slice(0, 1800)}`,
        validate: (t) => {
          try {
            const o = JSON.parse(t.match(/\{[\s\S]*\}/)![0]);
            return typeof o.question === 'string' && o.question.length > 10 && typeof o.topic === 'string' && o.topic.length > 5 ? { value: { question: o.question, topic: o.topic }, quality: 1 } : null;
          } catch {
            return null;
          }
        },
      });
      if (res.ok) {
        queries.push({ chunk: c.id, kind: 'pregunta', text: res.value.question }, { chunk: c.id, kind: 'tema', text: res.value.topic });
      } else {
        failures++;
        lastWhy = describeAttempts(res.attempts);
      }
      // Los niveles gratuitos limitan a ~30 peticiones por minuto: sin este ritmo, el cortacircuito aparta al proveedor.
      await new Promise((r) => setTimeout(r, 2500));
    }
    console.log(`  consultas generadas: ${queries.length / 2}/${sample.length}${failures ? `   (fallaron ${failures}; ultimo motivo: ${lastWhy})` : ''}`);
    if (queries.length === 0) {
      console.log('  No se pudo generar ninguna pregunta: configura una llave de la cadena "analysis" (npm run ai:doctor).');
      continue;
    }
    if (queries.length / 2 < 15) console.log('  AVISO: muestra pequena (<15): las cifras de abajo NO son concluyentes.');

    // 2. Buscar con cada estrategia y ver en que puesto sale el fragmento correcto.
    const search = async (s: Strategy, q: string): Promise<string[]> => {
      let emb: number[] | null = null;
      let text: string | null = q;
      let models: string[] | null = QUERYABLE_PROFILES;
      if (s === 'vector_legacy') {
        const e = await embedWithGemini(q, null, { normalize: false });
        emb = e.ok ? e.values : null;
        text = null;
        models = [LEGACY_EMBEDDING_PROFILE];
      } else if (s === 'vector_typed') {
        emb = await embedQuery(q);
        text = null;
      } else if (s === 'hybrid') {
        emb = await embedQuery(q);
      }
      if (s !== 'text' && !emb) return [];
      const { data } = await supabase.rpc('match_material_chunks_hybrid', { query_embedding: emb, query_text: text, classroom_id_filter: aula.id, material_ids: null, match_count: 10, vector_models: models });
      return ((data ?? []) as any[]).map((x) => x.chunk_id);
    };

    for (const kind of ['pregunta', 'tema'] as const) {
      const set = queries.filter((x) => x.kind === kind);
      const rows: any[] = [];
      for (const s of STRATEGIES) {
        let h1 = 0, h3 = 0, h5 = 0, rr = 0, answered = 0;
        for (const { chunk, text } of set) {
          const ranked = await search(s, text);
          if (ranked.length) answered++;
          const pos = ranked.indexOf(chunk);
          if (pos === 0) h1++;
          if (pos >= 0 && pos < 3) h3++;
          if (pos >= 0 && pos < 5) h5++;
          if (pos >= 0) rr += 1 / (pos + 1);
        }
        const n = set.length;
        rows.push({ estrategia: s, 'Hit@1': +(h1 / n).toFixed(3), 'Hit@3': +(h3 / n).toFixed(3), 'Hit@5': +(h5 / n).toFixed(3), 'MRR@10': +(rr / n).toFixed(3), respondio: `${answered}/${n}` });
      }
      console.log(`\n  Consultas tipo "${kind}" (${set.length}):`);
      console.table(rows);
      report.push({ aula: aula.name, tipo: kind, consultas: set.length, perfiles, resultados: rows });
    }
  }

  if (save && report.length) {
    const dir = path.join(process.cwd(), 'evals', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `retrieval-${new Date().toISOString().slice(0, 10)}-seed${seed}.json`);
    fs.writeFileSync(file, JSON.stringify({ fecha: new Date().toISOString(), seed, n: N, report }, null, 2));
    console.log(`\nGuardado en ${file}`);
  }
}

main().catch((e) => {
  console.error('eval-retrieval fallo:', String(e?.message ?? e));
  process.exit(1);
});
