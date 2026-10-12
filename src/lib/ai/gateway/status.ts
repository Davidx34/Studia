import { PROVIDERS, chainFor, isProviderConfigured } from './providers';
import { sharedHealth, type HealthTracker } from './health';
import type { AiTask } from './types';
import { EMBED_PROVIDERS, embedChain, isEmbedConfigured } from '@/lib/embeddings/providers';

type Env = Record<string, string | undefined>;

const TASKS: AiTask[] = ['generation', 'judge', 'analysis', 'study'];

// Estado de la pasarela de IA para el panel /dev. SOLO nombres y booleanos: nunca valores de llaves ni URLs con credenciales.
export function buildAiStatus(env: Env = process.env, health: HealthTracker = sharedHealth, now: number = Date.now()) {
  const snap = health.snapshot();
  return {
    providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, tier: p.tier, configured: isProviderConfigured(p, env), signup: p.signup })),
    chains: Object.fromEntries(TASKS.map((t) => [t, chainFor(t, env).map((c) => `${c.provider}:${c.model}`)])) as Record<AiTask, string[]>,
    // El historial vive en la memoria de la instancia que atiende esta peticion (Vercel tiene varias): es orientativo.
    breakers: Object.entries(snap).map(([key, h]) => ({
      key,
      available: h.available,
      reopensInSeconds: h.openUntil > now ? Math.round((h.openUntil - now) / 1000) : 0,
      successRate: Math.round(h.successEma * 100),
      latencyMs: Math.round(h.latencyEma),
      calls: h.calls,
    })),
    // Embeddings: proveedores activos y el orden en que se usaran. Solo nombres, perfiles y booleanos.
    embeddings: {
      providers: EMBED_PROVIDERS.map((p) => ({ id: p.id, label: p.label, configured: isEmbedConfigured(p, env), batch: p.maxBatch, commercialOk: p.commercialOk })),
      chain: embedChain(env).map((p) => p.profile),
    },
    flags: {
      serviceRoleKey: !!env.SUPABASE_SERVICE_ROLE_KEY,
      serverGrading: env.SERVER_GRADING === 'on',
    },
  };
}

export type AiStatus = ReturnType<typeof buildAiStatus>;
