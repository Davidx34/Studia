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
  }

  console.log('\n=== Cadenas por tarea (solo proveedores activos) ===');
  for (const task of TASKS) {
    const chain = chainFor(task);
    console.log(`\n  ${task}${chain.length === 0 ? '  -> SIN PROVEEDORES' : ''}`);
    for (const c of chain) {
      const models = listed.get(c.provider);
      const exists = !models ? '?' : has(models, c.model) || c.model === 'auto' || c.model === 'default' ? 'existe' : 'NO EXISTE (cambia AI_CHAIN_' + task.toUpperCase() + ')';
      let latency = '';
      if (ping) {
        const t0 = Date.now();
        const r = await callCandidate(c, { task, prompt: 'Responde solo con la palabra OK.', maxTokens: 8, temperature: 0 });
        latency = r.ok ? `  ok ${Date.now() - t0} ms` : `  FALLO ${r.kind}${r.status ? ' HTTP ' + r.status : ''}`;
      }
      console.log(`     ${c.provider.padEnd(11)} ${c.model.padEnd(44)} ${exists}${latency}`);
    }
  }
  console.log('\nCambiar una cadena (Vercel > Environment Variables): AI_CHAIN_GENERATION="cerebras:gpt-oss-120b,groq:llama-3.3-70b-versatile"\n');
}

main().catch((e) => {
  console.error('ai-doctor fallo:', String(e?.message ?? e));
  process.exit(1);
});
