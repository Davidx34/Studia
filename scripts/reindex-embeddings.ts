// REINDEXAR: recalcula los embeddings de los fragmentos del material con el perfil actual (RETRIEVAL_DOCUMENT + normalizado,
// ver src/lib/embeddings/embed.ts) y los marca en material_chunks.embedding_model.
//
// Por que existe: los fragmentos anteriores a la migracion 068 se calcularon sin taskType ni normalizar. Siguen sirviendo
// (mismo modelo y dimensiones) pero rinden menos. Este script los pone al dia SIN borrar nada: actualiza vector y perfil
// de cada fragmento solo cuando el nuevo vector ya se calculo bien.
//
// Es REANUDABLE: solo toca los fragmentos cuyo perfil no es el actual; si se agota la cuota gratuita de Gemini se detiene
// con un mensaje y se vuelve a ejecutar al dia siguiente.
//
// Uso (en TU maquina, con TU .env.local; no imprime llaves):
//   npx tsx --env-file=.env.local scripts/reindex-embeddings.ts --dry-run     (solo cuenta)
//   npx tsx --env-file=.env.local scripts/reindex-embeddings.ts               (todo lo pendiente)
//   npx tsx --env-file=.env.local scripts/reindex-embeddings.ts --limit 100   (un lote, por la cuota)

import { createClient } from '@supabase/supabase-js';
import { embedWithGemini, EMBEDDING_PROFILE } from '../src/lib/embeddings/embed';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const concurrency = args.includes('--concurrency') ? Number(args[args.indexOf('--concurrency') + 1]) : 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  if (!process.env.GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY en .env.local');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const pending = async () =>
    supabase.from('material_chunks').select('id', { count: 'exact', head: true }).or(`embedding_model.is.null,embedding_model.neq.${EMBEDDING_PROFILE}`);
  const { count: total } = await pending();
  console.log(`Perfil actual: ${EMBEDDING_PROFILE}`);
  console.log(`Fragmentos por reindexar: ${total ?? 0}`);
  if (dryRun || !total) return;

  let done = 0;
  let failed = 0;
  let quota = false;

  while (done + failed < limit && !quota) {
    const { data: rows } = await supabase
      .from('material_chunks')
      .select('id, content')
      .or(`embedding_model.is.null,embedding_model.neq.${EMBEDDING_PROFILE}`)
      .order('id')
      .limit(Math.min(50, limit - done - failed));
    if (!rows || rows.length === 0) break;

    let next = 0;
    const worker = async () => {
      while (next < rows.length && !quota) {
        const row = rows[next++];
        let r = await embedWithGemini(row.content, 'RETRIEVAL_DOCUMENT');
        // Limite por minuto: esperar y reintentar sirve. Cuota diaria: no.
        for (let attempt = 1; !r.ok && (r.kind === 'rate' || r.kind === 'server') && attempt <= 3; attempt++) {
          await sleep(5000 * attempt);
          r = await embedWithGemini(row.content, 'RETRIEVAL_DOCUMENT');
        }
        if (!r.ok) {
          if (r.kind === 'quota') quota = true;
          else failed++;
          continue;
        }
        const { error } = await supabase.from('material_chunks').update({ embedding: r.values as unknown as string, embedding_model: EMBEDDING_PROFILE }).eq('id', row.id);
        if (error) failed++;
        else done++;
        if ((done + failed) % 10 === 0) console.log(`  ...${done} reindexados${failed ? `, ${failed} con error` : ''}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
    // Si todo el lote fallo (no por cuota), no se insiste en bucle.
    if (rows.length > 0 && done === 0 && failed >= rows.length) break;
  }

  const { count: left } = await pending();
  console.log(`\nReindexados: ${done}${failed ? `   con error: ${failed}` : ''}   pendientes: ${left ?? '?'}`);
  if (quota) console.log('Se agoto la cuota gratuita de embeddings de Gemini. Vuelve a ejecutar el script manana: continua donde quedo.');
}

main().catch((e) => {
  console.error('reindex fallo:', String(e?.message ?? e));
  process.exit(1);
});
