// Juez local (offline/manual) sobre Ollama -- alternativa GRATIS e ILIMITADA
// a judgeModuleQuestionPool() (src/lib/actions/learning-objectives.ts), que
// usa Gemini Flash y esta limitado a 20 requests/dia en el free tier (ver
// comentario en src/lib/questions/judge.ts).
//
// Este script NO reemplaza al juez en vivo de la app (el boton "Revisar con
// juez IA" sigue corriendo en Vercel, que no tiene forma de llegar a un
// Ollama corriendo en esta maquina). Es un tool paralelo: corre EN TU PC,
// contra la base de datos REAL via service_role, usando la misma rubrica de
// judge.ts pero llamando a http://localhost:11434 en vez de Gemini. Los
// veredictos que escribe son indistinguibles para la app de los que hubiera
// puesto el juez en vivo -- mismos valores en review_status.
//
// Uso:
//   npx tsx --env-file=.env.local scripts/judge-local.ts <moduleId>
//   npx tsx --env-file=.env.local scripts/judge-local.ts --classroom <classroomId>
//   npx tsx --env-file=.env.local scripts/judge-local.ts <moduleId> --dry-run
//   npx tsx --env-file=.env.local scripts/judge-local.ts <moduleId> --model qwen2.5:3b --batch-size 5
//
// Requiere Ollama corriendo (`ollama serve`, o el servicio que arranca solo
// tras instalar) con el modelo bajado (`ollama pull qwen2.5:1.5b`).

import { createClient } from '@supabase/supabase-js';
import { getRagContext } from '../src/lib/questions/cohereGeneration';
import { RUBRIC, questionToText, parseBatchResponse, type JudgeResult } from '../src/lib/questions/judge';

// --- CLI ---------------------------------------------------------------

function parseArgs(argv: string[]) {
  const flags = { dryRun: false, model: '', batchSize: 0, classroom: false, retries: 2, positional: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--classroom') flags.classroom = true;
    else if (a === '--model') flags.model = argv[++i] || '';
    else if (a === '--batch-size') flags.batchSize = parseInt(argv[++i] || '0', 10) || 0;
    else if (a === '--retries') flags.retries = parseInt(argv[++i] || '0', 10) || 0;
    else flags.positional.push(a);
  }
  return flags;
}

const args = parseArgs(process.argv.slice(2));

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = args.model || process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';
// Mas chico que el de Gemini (8): modelos 1.5B-3B pierden precision con
// contextos largos y son mas propensos a truncar la respuesta a mitad de
// generacion en hardware CPU-only.
const BATCH_SIZE = args.batchSize || 3;
const BATCH_RETRIES = args.retries;
// Ollama usa 2048 tokens de contexto POR DEFECTO sin importar cuanto
// soporte el modelo -- con la rubrica (~400 tokens) + material fuente +
// varias preguntas, era muy facil pasarse de esa ventana y que la
// respuesta quedara truncada a mitad del JSON (causa mas probable de los
// fallos de parseo observados en la primera version de este script). Se
// fija explicitamente por encima de lo que necesita un lote de BATCH_SIZE.
const NUM_CTX = 4096;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

// --- Ollama: structured outputs -----------------------------------------
// En vez de solo PEDIR JSON en el prompt (lo que un modelo de 1.5-3B
// incumple con frecuencia: texto antes/despues, comillas mal cerradas,
// menos objetos de los pedidos), se le pasa un JSON Schema en el campo
// "format" de la API de Ollama. Esto activa decodificacion restringida por
// gramatica en el propio servidor: el modelo queda forzado a producir JSON
// que cumple el schema token a token, no es una sugerencia. minItems/
// maxItems=batch.length en particular elimina de raiz el caso de "el LLM
// devolvio menos objetos de los pedidos" que antes forzaba a descartar el
// lote entero.
function batchSchema(count: number) {
  return {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', minimum: 1, maximum: count },
            verdict: { type: 'string', enum: ['pass', 'fail', 'review'] },
            reason: { type: 'string' },
          },
          required: ['index', 'verdict', 'reason'],
        },
      },
    },
    required: ['verdicts'],
  };
}

const SINGLE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail', 'review'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
};

async function callOllama(prompt: string, schema: object, numPredict: number): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: schema,
        options: { temperature: 0, num_ctx: NUM_CTX, num_predict: numPredict },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`Ollama respondio ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return data?.response ?? null;
  } catch (e) {
    console.error('No se pudo conectar a Ollama en', OLLAMA_URL, '-- ¿esta corriendo "ollama serve"?', e);
    return null;
  }
}

// --- Prompting -----------------------------------------------------------

function buildBatchPrompt(batch: any[], sourceMaterial: string): string {
  const numbered = batch.map((q, i) => `### PREGUNTA ${i + 1}\n${questionToText(q)}`).join('\n\n');
  return `${RUBRIC}

Vas a evaluar VARIAS preguntas en una sola pasada. Da un veredicto independiente para CADA una -- no dejes que el veredicto de una pregunta influya en el de otra.

"index" es el numero de PREGUNTA (1-based). Debe haber EXACTAMENTE ${batch.length} veredictos, uno por pregunta.

MATERIAL FUENTE:
${(sourceMaterial || '').substring(0, 2500)}

${numbered}`;
}

function buildSinglePrompt(q: any, sourceMaterial: string): string {
  return `${RUBRIC}

MATERIAL FUENTE:
${(sourceMaterial || '').substring(0, 2500)}

PREGUNTA A EVALUAR:
${questionToText(q)}`;
}

// --- Juicio de un lote, con reintentos y fallback por pregunta -----------

async function judgeSingleLocal(q: any, sourceMaterial: string): Promise<JudgeResult | null> {
  const text = await callOllama(buildSinglePrompt(q, sourceMaterial), SINGLE_SCHEMA, 300);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!['pass', 'fail', 'review'].includes(parsed.verdict)) return null;
    return { verdict: parsed.verdict, reason: String(parsed.reason || '').slice(0, 500) };
  } catch {
    return null;
  }
}

async function judgeBatchLocal(batch: any[], sourceMaterial: string): Promise<(JudgeResult | null)[]> {
  const schema = batchSchema(batch.length);
  const numPredict = 120 * batch.length + 100;

  for (let attempt = 0; attempt <= BATCH_RETRIES; attempt++) {
    const text = await callOllama(buildBatchPrompt(batch, sourceMaterial), schema, numPredict);
    if (text) {
      const parsed = parseBatchResponse(text, batch.length);
      if (parsed && parsed.every((v) => v !== null)) return parsed;
      if (parsed && attempt === BATCH_RETRIES) return parsed; // parcial, mejor que nada -- el resto cae al fallback individual
    }
  }

  // El lote como unidad no dio un resultado completo tras los reintentos --
  // en vez de mandar TODO el lote a revision humana (como hacia la version
  // anterior), se juzga pregunta por pregunta. Mas lento, pero solo se paga
  // ese costo en el caso ya raro de que el lote completo falle.
  console.warn(`  lote de ${batch.length} no dio veredictos completos tras ${BATCH_RETRIES + 1} intento(s), evaluando pregunta por pregunta...`);
  const results: (JudgeResult | null)[] = [];
  for (const q of batch) {
    results.push(await judgeSingleLocal(q, sourceMaterial));
  }
  return results;
}

// --- Orquestacion ----------------------------------------------------------

interface ModuleStats {
  approved: number;
  rejected: number;
  humanReview: number;
  fallbackToSingle: number;
}

async function judgeModule(moduleId: string): Promise<ModuleStats | null> {
  const { data: mod } = await supabase.from('content_modules').select('id, title, classroom_id').eq('id', moduleId).single();
  if (!mod) {
    console.error(`Modulo ${moduleId} no encontrado.`);
    return null;
  }

  const { data: pending, error } = await supabase
    .from('lesson_questions')
    .select('*')
    .eq('module_id', moduleId)
    .eq('review_status', 'pending');

  if (error) {
    console.error(`Error trayendo preguntas de "${mod.title}":`, error.message);
    return null;
  }
  if (!pending || pending.length === 0) {
    console.log(`"${mod.title}": sin preguntas pendientes, se salta.`);
    return null;
  }

  console.log(`\n"${mod.title}": ${pending.length} preguntas pendientes.${args.dryRun ? ' (dry-run, no se escribe en la base)' : ''}`);
  const sourceMaterial = await getRagContext(supabase, moduleId);

  const stats: ModuleStats = { approved: 0, rejected: 0, humanReview: 0, fallbackToSingle: 0 };
  const totalBatches = Math.ceil(pending.length / BATCH_SIZE);
  const runStart = Date.now();

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const t0 = Date.now();
    process.stdout.write(`  lote ${batchNum}/${totalBatches} (${batch.length} preg.)... `);
    const verdicts = await judgeBatchLocal(batch, sourceMaterial);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    let batchSummary = '';
    for (let j = 0; j < batch.length; j++) {
      const q = batch[j];
      const v = verdicts[j];
      let status: string;
      if (!v) {
        status = 'human_review';
        stats.humanReview++;
      } else if (v.verdict === 'pass') {
        status = 'approved';
        stats.approved++;
      } else if (v.verdict === 'fail') {
        status = 'rejected';
        stats.rejected++;
      } else {
        status = 'human_review';
        stats.humanReview++;
      }
      if (!args.dryRun) {
        const update: Record<string, unknown> = { review_status: status };
        if (status === 'rejected') update.is_backup = true;
        await supabase.from('lesson_questions').update(update).eq('id', q.id);
      }
      batchSummary += status[0].toUpperCase();
    }
    console.log(`${batchSummary}  (${elapsed}s)`);
  }

  const totalElapsed = ((Date.now() - runStart) / 1000).toFixed(1);
  console.log(
    `  -> aprobadas: ${stats.approved}, rechazadas: ${stats.rejected}, a revision humana: ${stats.humanReview}  ` +
      `(${totalElapsed}s total, ${(Number(totalElapsed) / pending.length).toFixed(1)}s/pregunta)`
  );
  return stats;
}

async function main() {
  if (args.positional.length === 0) {
    console.error(
      'Uso:\n' +
        '  judge-local.ts <moduleId>\n' +
        '  judge-local.ts --classroom <classroomId>\n' +
        'Flags: --dry-run  --model <nombre>  --batch-size <n>  --retries <n>'
    );
    process.exit(1);
  }

  console.log(`Juez local: Ollama en ${OLLAMA_URL}, modelo ${OLLAMA_MODEL}, lote=${BATCH_SIZE}, num_ctx=${NUM_CTX}, reintentos=${BATCH_RETRIES}`);
  const ping = await callOllama('Confirma que estas listo.', SINGLE_SCHEMA_PING, 50);
  if (!ping) {
    console.error(
      `Ollama no respondio. Corre "ollama serve" en otra terminal (o revisa que el servicio este activo) y que el modelo este bajado con "ollama pull ${OLLAMA_MODEL}".`
    );
    process.exit(1);
  }

  const totals: ModuleStats = { approved: 0, rejected: 0, humanReview: 0, fallbackToSingle: 0 };
  const accumulate = (s: ModuleStats | null) => {
    if (!s) return;
    totals.approved += s.approved;
    totals.rejected += s.rejected;
    totals.humanReview += s.humanReview;
  };

  if (args.classroom) {
    const classroomId = args.positional[0];
    const { data: modules } = await supabase.from('content_modules').select('id, title').eq('classroom_id', classroomId).order('order_index');
    if (!modules || modules.length === 0) {
      console.error('No se encontraron modulos para esa clase.');
      process.exit(1);
    }
    for (const m of modules) {
      accumulate(await judgeModule(m.id));
    }
    console.log(`\nTotal clase -> aprobadas: ${totals.approved}, rechazadas: ${totals.rejected}, a revision humana: ${totals.humanReview}`);
  } else {
    await judgeModule(args.positional[0]);
  }

  console.log('\nListo.');
}

// Schema minimo solo para el ping inicial de salud (no forma parte del
// juicio real, solo confirma que Ollama y el modelo responden antes de
// gastar tiempo procesando preguntas).
const SINGLE_SCHEMA_PING = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

main();
