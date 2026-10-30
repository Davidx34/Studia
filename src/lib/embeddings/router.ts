import { HealthTracker, keyOf, sharedHealth } from '@/lib/ai/gateway/health';
import { defaultHealthStore, persistBlock, syncPersistedHealth, type HealthStore } from '@/lib/ai/gateway/persist';
import type { Attempt } from '@/lib/ai/gateway/types';
import { embedBatch } from './client';
import { embedChain, embedProviderForProfile, type EmbedProvider, type EmbedRole } from './providers';

type Env = Record<string, string | undefined>;

export type EmbedRouteResult =
  | { ok: true; profile: string; provider: string; vectors: number[][]; attempts: Attempt[] }
  | { ok: false; reason: 'no_providers' | 'all_unavailable' | 'exhausted'; attempts: Attempt[] };

export interface EmbedRouteOptions {
  // Fuerza un perfil concreto (p. ej. para consultar contra los fragmentos indexados con ese perfil).
  profile?: string;
  // Para reindexar sin mezclar: solo estos proveedores.
  only?: string[];
  maxAttempts?: number;
  deps?: { env?: Env; fetchImpl?: typeof fetch; health?: HealthTracker; now?: () => number; healthStore?: HealthStore | null };
}

// Embebe TODOS los textos con UN mismo proveedor (los vectores de proveedores distintos no se pueden mezclar en un mismo
// conjunto): parte los textos en lotes de su tamaño maximo y, si algun lote falla, pasa al siguiente proveedor y reinicia el
// conjunto completo. Respeta el cortacircuito compartido con la pasarela de texto. Nunca lanza.
export async function embedTexts(texts: string[], role: EmbedRole, opts: EmbedRouteOptions = {}): Promise<EmbedRouteResult> {
  const env = opts.deps?.env ?? process.env;
  const health = opts.deps?.health ?? sharedHealth;
  const now = opts.deps?.now ?? Date.now;

  let providers: EmbedProvider[];
  if (opts.profile) {
    const p = embedProviderForProfile(opts.profile, env);
    providers = p ? [p] : [];
  } else {
    providers = embedChain(env);
  }
  if (opts.only) providers = providers.filter((p) => opts.only!.includes(p.id));
  if (providers.length === 0) return { ok: false, reason: 'no_providers', attempts: [] };

  // La salud se registra por (proveedor, perfil), igual que en la pasarela de texto.
  const cands = providers.map((p) => ({ provider: `embed:${p.id}`, model: p.profile }));
  // Bloqueos largos (cuota diaria...) que otra instancia ya descubrio: la cuota gratuita de embeddings es la mas escasa.
  const store = opts.deps?.healthStore !== undefined ? opts.deps.healthStore : await defaultHealthStore(env);
  await syncPersistedHealth(health, store, now());
  const rankedCands = health.rank(cands);
  if (rankedCands.length === 0) return { ok: false, reason: 'all_unavailable', attempts: [] };
  const byKey = new Map(cands.map((c, i) => [`${c.provider}:${c.model}`, providers[i]]));

  const attempts: Attempt[] = [];
  for (const cand of rankedCands.slice(0, opts.maxAttempts ?? 3)) {
    const p = byKey.get(`${cand.provider}:${cand.model}`)!;
    const t0 = now();
    const vectors: number[][] = [];
    let failure: { kind: any; status?: number; retryAfterMs?: number } | null = null;

    for (let i = 0; i < texts.length; i += p.maxBatch) {
      const out = await embedBatch(p, texts.slice(i, i + p.maxBatch), role, env, opts.deps?.fetchImpl);
      if (!out.ok) {
        failure = out;
        break;
      }
      vectors.push(...out.vectors);
    }

    const ms = now() - t0;
    if (failure) {
      const f = health.failure(cand, failure.kind, failure.retryAfterMs);
      await persistBlock(store, { key: keyOf(cand), kind: failure.kind, openUntil: f.openUntil }, f.openMs);
      attempts.push({ provider: cand.provider, model: cand.model, ok: false, kind: failure.kind, status: failure.status, ms });
      continue;
    }
    health.success(cand, ms);
    attempts.push({ provider: cand.provider, model: cand.model, ok: true, ms });
    return { ok: true, profile: p.profile, provider: p.id, vectors, attempts };
  }
  return { ok: false, reason: 'exhausted', attempts };
}
