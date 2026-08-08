#!/usr/bin/env node
// Fase 1.2 (post-auditoria, Protocolo 7.6): script MANUAL de saneamiento.
//
// Antes de la taxonomia cerrada (classroom_concepts, migracion 039) cada
// pregunta traia su propio concept_tag "libre", generado por el LLM en el
// momento. Sobre datos de sesiones de prueba anteriores (no del piloto de
// Microeconomia -- ese arranca con la taxonomia cerrada desde el primer
// modulo) eso produjo variantes del mismo concepto conviviendo como si
// fueran distintas.
//
// Este script es de SOLO LECTURA: agrupa los concept_tag existentes de
// lesson_questions por similitud de embedding (Gemini) y PROPONE merges.
// No escribe nada en la base de datos -- el profesor/dev decide y aplica
// los merges a mano (UPDATE manual o desde un futuro panel). Deliberado:
// fusionar automaticamente es peligroso (falsos positivos rompen
// analitica silenciosamente, el mismo patron de "falla en silencio" que
// la auditoria ya documento para RLS).
//
// Uso:
//   GEMINI_API_KEY=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/sanitize-concept-tags.mjs [classroom_id] [--threshold=0.92]
//
// Sin classroom_id: corre sobre TODOS los concept_tag de lesson_questions.
// SUPABASE_SERVICE_ROLE_KEY (no el anon key) porque necesita leer a traves
// de clases que no son necesariamente las del usuario que corre el script.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const GEMINI_EMBED_DIMENSIONS = 768;

const args = process.argv.slice(2);
const classroomId = args.find((a) => !a.startsWith('--'));
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
const THRESHOLD = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.92;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('Falta GEMINI_API_KEY en el entorno (necesaria para generar embeddings).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function embed(text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: GEMINI_EMBED_DIMENSIONS,
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini embed fallo (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return json?.embedding?.values || null;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  console.log(`Umbral de similitud: ${THRESHOLD}${classroomId ? ` · classroom_id=${classroomId}` : ' · TODAS las clases'}\n`);

  let query = supabase
    .from('lesson_questions')
    .select('concept_tag, module_id, content_modules!inner(classroom_id, title)')
    .not('concept_tag', 'is', null);
  if (classroomId) query = query.eq('content_modules.classroom_id', classroomId);

  const { data, error } = await query;
  if (error) {
    console.error('Error consultando lesson_questions:', error.message);
    process.exit(1);
  }

  // Agrupa por tag, guarda el titulo de modulo como contexto humano legible
  const byTag = new Map();
  for (const row of data) {
    const tag = row.concept_tag;
    if (!byTag.has(tag)) byTag.set(tag, { count: 0, moduleTitle: row.content_modules?.title || '' });
    byTag.get(tag).count += 1;
  }

  const tags = [...byTag.keys()];
  console.log(`${tags.length} concept_tag distintos sobre ${data.length} filas.\n`);
  if (tags.length === 0) {
    console.log('Nada que sanear.');
    return;
  }

  console.log('Generando embeddings (1 llamada a Gemini por tag distinto)...');
  const embeddings = {};
  for (const tag of tags) {
    // El tag solo (snake_case) tiene poca senal semantica por si solo;
    // se le suma el titulo del modulo de origen como contexto.
    const text = `${tag.replace(/_/g, ' ')} (${byTag.get(tag).moduleTitle})`;
    embeddings[tag] = await embed(text);
  }

  // Clustering simple por umbral (union-find): no requiere elegir K de antemano,
  // apropiado para "proponer merges", no para una clasificacion definitiva.
  const parent = new Map(tags.map((t) => [t, t]));
  function find(x) { while (parent.get(x) !== x) x = parent.get(x); return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }

  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const sim = cosineSim(embeddings[tags[i]], embeddings[tags[j]]);
      if (sim >= THRESHOLD) union(tags[i], tags[j]);
    }
  }

  const groups = new Map();
  for (const t of tags) {
    const root = find(t);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }

  const proposals = [...groups.values()].filter((g) => g.length > 1);
  console.log(`\n${proposals.length} grupo(s) de posible merge (similitud >= ${THRESHOLD}):\n`);
  for (const group of proposals) {
    console.log('  ' + group.map((t) => `${t} (${byTag.get(t).count})`).join('  <->  '));
  }
  if (proposals.length === 0) {
    console.log('  (ninguno por encima del umbral -- prueba bajar --threshold si esperabas encontrar duplicados)');
  }
  console.log('\nEsto es una PROPUESTA de solo lectura. Revisar a mano antes de aplicar cualquier UPDATE.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
