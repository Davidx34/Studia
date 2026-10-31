// BARRIDO DE HIPERPARAMETROS DE LA RECUPERACION (RAG).
//
// Mide, sobre los modulos REALES de una clase, como cambian tres propiedades del contexto que recibe la generacion al variar:
//   - el peso del texto en la busqueda hibrida (RAG_TEXT_WEIGHT, de 0 a 2),
//   - la constante k de la fusion RRF (RAG_RRF_K),
//   - el corte relativo de relevancia (RAG_CUTOFF_RATIO).
// Propiedades (src/lib/rag/tuning.ts): diversidad entre modulos (que dos modulos no reciban el mismo contexto), cobertura del documento y precision de conceptos clave.
// Solo LECTURA: no escribe nada en la base. Gasta embeddings de consulta (uno por variante de cada modulo, con cache) y llamadas baratas a la funcion hibrida.
//
// LIMITE: la metrica es un SUSTITUTO (no hay una verdad etiquetada) y los conceptos clave salen de la propia tuberia. Solo se recomienda cambiar un valor si la mejora
// es clara y nada empeora de forma notable. La relevancia contra una verdad conocida la mide `npm run eval:retrieval`.
//
// Uso (en TU maquina, con TU .env.local):
//   npx tsx --env-file=.env.local scripts/eval-rag-sweep.ts
//   npx tsx --env-file=.env.local scripts/eval-rag-sweep.ts --classroom <id> --guardar

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { embedQuery, QUERYABLE_PROFILES } from '../src/lib/embeddings/embed';
import { buildQueryVariants } from '../src/lib/rag/queries';
import { RAG_CUTOFF_RATIO, RAG_RRF_K, RAG_TEXT_WEIGHT } from '../src/lib/rag/retrieve';
import { DEFAULT_GRID, recommend, sweep, type ModuleRun, type SweepRow } from '../src/lib/rag/tuning';
import { RAG_CONTEXT_CHAR_LIMIT } from '../src/lib/questions/cohereGeneration';
import type { Retrieved } from '../src/lib/rag/fusion';

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const classroomArg = arg('--classroom');
const save = args.includes('--guardar');
const CANDIDATES = 12;
const MAX_CHUNKS = 8;

const toRetrieved = (r: any): Retrieved => ({
  chunk_id: String(r.chunk_id),
  content: String(r.content ?? ''),
  material_id: String(r.material_id),
  chunk_index: Number(r.chunk_index ?? 0),
  filename: r.filename ?? null,
  score: Number(r.score ?? 0),
});

const pct = (n: number) => (n * 100).toFixed(1).padStart(5) + '%';
const row = (r: SweepRow) =>
  `w=${String(r.textWeight).padEnd(4)} k=${String(r.k).padEnd(3)} corte=${String(r.cutoffRatio).padEnd(4)}  compuesto ${r.metrics.composite.toFixed(3)}  diversidad ${pct(r.metrics.diversity)}  cobertura ${pct(r.metrics.coverage)}  precision ${pct(r.metrics.conceptPrecision)}  recall ${pct(r.metrics.conceptRecall)}  pares identicos ${r.metrics.identicalPairs}`;

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan variables de Supabase en .env.local');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: classrooms } = classroomArg ? await supabase.from('classrooms').select('id, name').eq('id', classroomArg) : await supabase.from('classrooms').select('id, name');
  const report: unknown[] = [];

  for (const aula of classrooms ?? []) {
    const { data: modules } = await supabase.from('content_modules').select('id, title, description, topic_keywords, source_material_ids').eq('classroom_id', aula.id);
    const mods = (modules ?? []).filter((m) => m.title);
    if (mods.length < 2) {
      console.log(`\n=== ${aula.name}: ${mods.length} modulo(s); la diversidad entre modulos necesita al menos 2. Se omite. ===`);
      continue;
    }
    console.log(`\n=== ${aula.name} — ${mods.length} modulos ===`);

    // Embeddings de las consultas, UNA vez por texto y con ritmo (la API gratuita rechaza rafagas).
    const cache = new Map<string, number[] | null>();
    const embed = async (text: string) => {
      if (!cache.has(text)) {
        await new Promise((r) => setTimeout(r, 700));
        cache.set(text, await embedQuery(text));
      }
      return cache.get(text)!;
    };

    const perModule = [] as { mod: (typeof mods)[number]; variants: string[]; embeddings: (number[] | null)[]; scope: string[] | null; scopeChunks: number }[];
    let missing = 0;
    let withoutMaterial = 0;
    for (const m of mods) {
      // Primero el material: un modulo sin fragmentos no recupera nada, y dos contextos VACIOS no son contextos "identicos" (falsearian la diversidad). Se excluye sin gastar embeddings.
      const scopedIds: string[] = Array.isArray(m.source_material_ids) ? m.source_material_ids : [];
      let scopeChunks = 0;
      if (scopedIds.length > 0) {
        const { count } = await supabase.from('material_chunks').select('id', { count: 'exact', head: true }).in('material_id', scopedIds);
        scopeChunks = count ?? 0;
      }
      if (scopeChunks === 0) {
        const { data: mats } = await supabase.from('teaching_materials').select('id').eq('classroom_id', aula.id).eq('processing_status', 'completed');
        const ids = (mats ?? []).map((x) => x.id);
        if (ids.length) {
          const { count } = await supabase.from('material_chunks').select('id', { count: 'exact', head: true }).in('material_id', ids);
          scopeChunks = count ?? 0;
        }
      }
      if (scopeChunks === 0) {
        withoutMaterial++;
        continue;
      }
      const variants = buildQueryVariants({ title: m.title, description: m.description, keywords: m.topic_keywords });
      const embeddings: (number[] | null)[] = [];
      for (const v of variants) embeddings.push(await embed(v));
      missing += embeddings.filter((e) => e === null).length;
      perModule.push({ mod: m, variants, embeddings, scope: scopedIds.length > 0 ? scopedIds : null, scopeChunks });
    }
    if (withoutMaterial > 0) console.log(`  ${withoutMaterial} modulo(s) sin material (0 fragmentos): se excluyen de la medicion.`);
    if (perModule.length < 2) {
      console.log('  Quedan menos de 2 modulos con material: no hay diversidad entre modulos que medir. Se omite esta clase.');
      continue;
    }
    if (missing > 0) {
      console.log(`  ${missing} consulta(s) sin embedding (¿cuota de Gemini?). Sin vectores el barrido del peso del texto no mide lo que debe: se omite esta clase.`);
      continue;
    }

    const runsByWeight = new Map<number, ModuleRun[]>();
    for (const w of DEFAULT_GRID.textWeights) {
      const runs: ModuleRun[] = [];
      for (const p of perModule) {
        const search = (materialIds: string[] | null) =>
          Promise.all(
            p.variants.map((v, i) =>
              supabase.rpc('match_material_chunks_hybrid', {
                query_embedding: p.embeddings[i],
                query_text: v,
                classroom_id_filter: aula.id,
                material_ids: materialIds,
                match_count: CANDIDATES,
                vector_models: QUERYABLE_PROFILES,
                vector_weight: 1.0,
                text_weight: w,
              })
            )
          );
        let results = await search(p.scope);
        // Igual que la recuperacion de produccion: material vinculado sin resultados -> toda la clase.
        if (p.scope && results.every((r) => !r.error && (r.data ?? []).length === 0)) results = await search(null);
        const failed = results.find((r) => r.error);
        if (failed) throw new Error(`La busqueda hibrida fallo (${String(failed.error?.message ?? failed.error)}). ¿Esta aplicada la migracion 069?`);
        runs.push({ moduleId: p.mod.id, keywords: (p.mod.topic_keywords ?? []) as string[], lists: results.map((r) => ((r.data ?? []) as any[]).map(toRetrieved)), scopeChunks: p.scopeChunks });
      }
      runsByWeight.set(w, runs);
    }

    const rows = sweep(runsByWeight, { charLimit: RAG_CONTEXT_CHAR_LIMIT, maxChunks: MAX_CHUNKS });
    const current = { textWeight: RAG_TEXT_WEIGHT, k: RAG_RRF_K, cutoffRatio: RAG_CUTOFF_RATIO };
    const rec = recommend(rows, current);

    console.log('\n  Las 8 mejores configuraciones:');
    rows.slice(0, 8).forEach((r) => console.log('   ' + row(r)));
    if (rec?.baseline) console.log('\n  Configuracion ACTUAL:\n   ' + row(rec.baseline));
    if (rec) console.log(`\n  ${rec.change ? 'RECOMENDACION: cambiar a' : 'Sin cambio recomendado.'} ${rec.reason}`);
    const noKeywords = perModule.filter((p) => !(p.mod.topic_keywords ?? []).length).length;
    if (noKeywords > 0) console.log(`  AVISO: ${noKeywords} modulo(s) sin palabras clave: su precision de conceptos clave es 0 y no distingue configuraciones.`);
    report.push({ aula: aula.name, modulos: mods.length, actual: current, top: rows.slice(0, 15), baseline: rec?.baseline ?? null, recomendacion: rec ? { cambiar: rec.change, razon: rec.reason, mejor: rec.best } : null });
  }

  if (save && report.length) {
    const dir = path.join(process.cwd(), 'evals', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `rag-sweep-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(out, JSON.stringify({ fecha: new Date().toISOString(), report }, null, 2));
    console.log(`\nGuardado en ${out}`);
  }
}

main().catch((e) => {
  console.error('eval-rag-sweep fallo:', String(e?.message ?? e));
  process.exit(1);
});
