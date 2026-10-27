// DIAGNOSTICO de la pasarela de IA: ¿que proveedores tienen llave, que modelos de cada cadena existen de verdad y cuanto
// tardan?
//
// Los identificadores de modelo y los limites gratuitos cambian sin aviso. En vez de adivinar, este script le pregunta a cada
// proveedor configurado que modelos tiene (GET /models) y marca los de las cadenas que ya no existen.
//
// Uso:
//   npx tsx --env-file=.env.local scripts/ai-doctor.ts           (solo lista modelos: no gasta cuota de generacion)
//   npx tsx --env-file=.env.local scripts/ai-doctor.ts --ping    (ademas manda 1 peticion minima a cada candidato)
//
// Nunca imprime llaves. Corre en TU maquina con TU .env.local; no sube nada.

import { PROVIDERS, chainFor, isProviderConfigured, resolveBaseUrl, type ProviderDef } from '../src/lib/ai/gateway/providers';
import { callCandidate } from '../src/lib/ai/gateway/client';
import type { AiTask } from '../src/lib/ai/gateway/types';
import { EMBED_PROVIDERS, embedChain, isEmbedConfigured, resolveEmbedProvider } from '../src/lib/embeddings/providers';
import { embedBatch } from '../src/lib/embeddings/client';
import { modelChain, probeGeminiModel } from '../src/lib/ai/geminiDirect';
import { aiProfile, type GeminiRole } from '../src/lib/ai/geminiModels';

const TASKS: AiTask[] = ['generation', 'judge', 'analysis', 'study'];
const ping = process.argv.includes('--ping');

async function listModels(p: ProviderDef): Promise<string[] | null> {
  if (p.custom) return null; // OpenRouter tiene catalogo propio (y modelos ":free" aparte)
  const base = resolveBaseUrl(p);
  if (!base) return null;
  try {
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${process.env[p.keyEnv]}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    const list = Array.isArray(json) ? json : json?.data ?? json?.models ?? [];
    return list.map((m: any) => String(m?.id ?? m?.name ?? '')).filter(Boolean);
  } catch {
    return null;
  }
}

const has = (models: string[], id: string) => models.some((m) => m === id || m.endsWith(`/${id}`) || m === `models/${id}`);

async function main() {
  console.log('\n=== Proveedores ===');
  const listed = new Map<string, string[] | null>();
  for (const p of PROVIDERS) {
    const on = isProviderConfigured(p);
    if (!on) {
      console.log(`  ·  ${p.label.padEnd(44)} sin llave (${p.keyEnv}${(p.extraEnv ?? []).length ? ' + ' + p.extraEnv!.join(', ') : ''})  ->  ${p.signup}`);
      continue;
    }
    const models = await listModels(p);
    listed.set(p.id, models);
    console.log(`  ✔  ${p.label.padEnd(44)} activo${models ? `, ${models.length} modelos` : ', (no se pudo listar modelos)'}  [${p.tier}]`);
    // Los modelos REALES de tu cuenta (solo los de chat; se omiten voz, moderacion y embeddings).
    if (models) {
      const chat = models.filter((m) => !/whisper|orpheus|tts|guard|safeguard|embed|moderation|rerank|image/i.test(m)).sort();
      console.log(`       modelos de chat: ${chat.map((m) => m.replace('models/', '')).join(', ')}`);
    }
  }

  console.log('\n=== Cadenas por tarea (solo proveedores activos) ===');
  for (const task of TASKS) {
    const chain = chainFor(task);
    console.log(`\n  ${task}${chain.length === 0 ? '  -> SIN PROVEEDORES' : ''}`);
    for (const c of chain) {
      const models = listed.get(c.provider);
      let exists: string;
      if (!models) exists = '?';
      else if (has(models, c.model) || c.model === 'auto' || c.model === 'default') exists = 'en la lista';
      else {
        // Sugerencias: modelos del mismo proveedor con la misma familia (primera palabra del nombre).
        const family = (c.model.split('/').pop() ?? c.model).split(/[-.:]/)[0]; // "llama", "gpt", "gemini", "mistral"...
        const near = models.filter((m) => m.toLowerCase().includes(family.toLowerCase())).slice(0, 4);
        exists = 'NO EXISTE' + (near.length ? `; parecidos: ${near.join(', ')}` : '') + ` (cambia AI_CHAIN_${task.toUpperCase()})`;
      }
      let latency = '';
      if (ping) {
        const t0 = Date.now();
        const r = await callCandidate(c, { task, prompt: 'Responde solo con la palabra OK.', maxTokens: 256, temperature: 0 });
        latency = r.ok ? `  ok ${Date.now() - t0} ms` : `  FALLO ${r.kind}${r.status ? ' HTTP ' + r.status : ''}${r.message ? ' — ' + r.message : ''}`;
      }
      console.log(`     ${c.provider.padEnd(11)} ${c.model.padEnd(44)} ${exists}${latency}`);
    }
  }
  // Las piezas que llaman a Gemini DIRECTO (no por la pasarela): su cadena de modelos y, con --ping, una prueba REAL de cada modelo.
  // La lista de modelos de arriba puede decir "en la lista" y la llamada dar 404 (caso real 2026-10-26: gemini-2.5-flash con una llave nueva).
  console.log(`\n=== Gemini directo (perfil: ${aiProfile()}) ===`);
  if (!process.env.GEMINI_API_KEY) console.log('  sin GEMINI_API_KEY');
  else {
    const probed = new Map<string, string>();
    for (const role of ['judge', 'pdf', 'chunks', 'topics'] as GeminiRole[]) {
      console.log(`\n  ${role}`);
      for (const model of modelChain(role)) {
        let state = '';
        if (ping) {
          if (!probed.has(model)) {
            const r = await probeGeminiModel(model);
            probed.set(model, r.ok ? `ok ${r.ms} ms` : `NO SIRVE (HTTP ${r.status}, ${r.kind})`);
          }
          state = '  ' + probed.get(model);
        }
        console.log(`     ${model.padEnd(28)}${state}`);
      }
    }
    if (!ping) console.log('\n  (sin --ping no se prueba de verdad: un modelo puede figurar en la lista y dar 404 con tu llave)');
  }

  console.log('\n=== Embeddings ===');
  for (const base of EMBED_PROVIDERS) {
    if (!isEmbedConfigured(base)) {
      console.log(`  ·  ${base.label.padEnd(44)} sin llave (${base.keyEnv}${(base.extraEnv ?? []).length ? ' + ' + base.extraEnv!.join(', ') : ''})  ->  ${base.signup}`);
      continue;
    }
    const p = resolveEmbedProvider(base);
    if (!p) {
      console.log(`  !  ${base.label.padEnd(44)} con llave pero mal configurado (revisa sus variables)`);
      continue;
    }
    let pingInfo = '';
    if (ping) {
      const t0 = Date.now();
      const sample = ['El bienestar social en competencia perfecta.', 'La restriccion presupuestaria del consumidor.'].slice(0, Math.min(2, p.maxBatch));
      const r = await embedBatch(p, sample, 'document');
      pingInfo = r.ok ? `  ok ${Date.now() - t0} ms, ${r.vectors.length} vector(es) de ${r.vectors[0]?.length} dims` : `  FALLO ${r.kind}${r.status ? ' HTTP ' + r.status : ''}${r.message ? ' — ' + r.message : ''}`;
    }
    console.log(`  ✔  ${p.label.padEnd(44)} activo  perfil ${p.profile}  lote ${p.maxBatch}${p.commercialOk ? '' : '  [SOLO USO NO COMERCIAL]'}${pingInfo}`);
  }
  console.log(`  Orden de uso: ${embedChain().map((p) => p.profile).join(' -> ') || '(ninguno)'}`);

  console.log('\nCambiar una cadena (Vercel > Environment Variables): AI_CHAIN_GENERATION="cerebras:gpt-oss-120b,groq:openai/gpt-oss-120b"\n');
}

main().catch((e) => {
  console.error('ai-doctor fallo:', String(e?.message ?? e));
  process.exit(1);
});
