// Catalogo de proveedores de EMBEDDINGS (paso 1 de la fase 2b, docs/AUDITORIA_IA_Y_PLAN.md).
//
// Por que existe: el nivel gratuito de embeddings de Gemini admite ~100 llamadas al dia y NO admite lotes (un fragmento = una
// llamada). Varios proveedores aceptan un arreglo de textos por peticion: 197 fragmentos pasan a ser 2 peticiones.
//
// Un vector solo es comparable con vectores del MISMO perfil (modelo + dimensiones + configuracion): cada proveedor declara
// el suyo. Los identificadores de modelo y los parametros de cada API son los documentados habitualmente y NO estan todos
// verificados (aun sin llave): `npm run ai:doctor -- --ping` comprueba que cada proveedor activo responde y con las
// dimensiones que dice tener.

export type EmbedRole = 'document' | 'query';

export interface EmbedProvider {
  id: string;
  label: string;
  // Perfil guardado junto al vector (material_chunks.embedding_model / material_chunk_embeddings.profile).
  profile: string;
  model: string;
  dims: number;
  keyEnv: string;
  extraEnv?: string[];
  // Textos por peticion. 1 = sin lotes (Gemini gratuito).
  maxBatch: number;
  // Forma de la API.
  api: 'gemini' | 'openai' | 'voyage' | 'jina';
  // URL base; admite {VARIABLE} del entorno.
  baseUrl: string;
  tier: 'free' | 'paid' | 'self';
  free: string;
  // false = el nivel gratuito es solo para uso NO comercial.
  commercialOk: boolean;
  signup: string;
}

export const EMBED_PROVIDERS: EmbedProvider[] = [
  {
    id: 'gemini',
    label: 'Google Gemini (gemini-embedding-001)',
    profile: 'gemini-embedding-001:768:rt',
    model: 'gemini-embedding-001',
    dims: 768,
    keyEnv: 'GEMINI_API_KEY',
    maxBatch: 1,
    api: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    tier: 'free',
    free: 'en esta llave: ~100 llamadas/dia (observado); sin lotes en el nivel gratuito; con facturacion: 0,15 USD por millon de tokens',
    commercialOk: true,
    signup: 'https://aistudio.google.com',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI (bge-m3)',
    profile: 'cloudflare-bge-m3:1024',
    model: '@cf/baai/bge-m3',
    dims: 1024,
    keyEnv: 'CLOUDFLARE_API_TOKEN',
    extraEnv: ['CLOUDFLARE_ACCOUNT_ID'],
    maxBatch: 32,
    api: 'openai',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1',
    tier: 'free',
    free: '10.000 neurons/dia compartidos con la IA de texto (~9 M de tokens/dia solo en embeddings, estimado); lotes; multilingue',
    commercialOk: true,
    signup: 'https://dash.cloudflare.com',
  },
  {
    id: 'voyage',
    label: 'Voyage AI (voyage-3.5-lite)',
    profile: 'voyage-3.5-lite:1024',
    model: 'voyage-3.5-lite',
    dims: 1024,
    keyEnv: 'VOYAGE_API_KEY',
    maxBatch: 64,
    api: 'voyage',
    baseUrl: 'https://api.voyageai.com/v1',
    tier: 'free',
    free: '200 M de tokens gratuitos por cuenta (segun su documentacion); lotes; multilingue',
    commercialOk: true,
    signup: 'https://www.voyageai.com',
  },
  {
    id: 'jina',
    label: 'Jina AI (jina-embeddings-v3)',
    profile: 'jina-embeddings-v3:768',
    model: 'jina-embeddings-v3',
    dims: 768,
    keyEnv: 'JINA_API_KEY',
    maxBatch: 64,
    api: 'jina',
    baseUrl: 'https://api.jina.ai/v1',
    tier: 'free',
    free: '~10 M de tokens gratuitos (cifras contradictorias entre fuentes); SOLO USO NO COMERCIAL en el nivel gratuito',
    commercialOk: false,
    signup: 'https://jina.ai',
  },
  {
    id: 'mistral',
    label: 'Mistral (mistral-embed)',
    profile: 'mistral-embed:1024',
    model: 'mistral-embed',
    dims: 1024,
    keyEnv: 'MISTRAL_API_KEY',
    maxBatch: 32,
    api: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    tier: 'free',
    free: 'plan Experiment (limites en la consola; pide telefono verificado y aceptar uso para entrenar)',
    commercialOk: true,
    signup: 'https://console.mistral.ai',
  },
  {
    id: 'custom',
    label: 'Compatible con OpenAI (propio)',
    profile: 'custom-embed',
    model: 'default', // se sustituye por AI_EMBED_CUSTOM_MODEL
    dims: 0, // se sustituye por AI_EMBED_CUSTOM_DIMS
    keyEnv: 'AI_EMBED_CUSTOM_API_KEY',
    extraEnv: ['AI_EMBED_CUSTOM_BASE_URL', 'AI_EMBED_CUSTOM_MODEL', 'AI_EMBED_CUSTOM_DIMS'],
    maxBatch: 32,
    api: 'openai',
    baseUrl: '{AI_EMBED_CUSTOM_BASE_URL}',
    tier: 'self',
    free: 'cualquier servicio con /embeddings compatible con OpenAI (LiteLLM, Ollama, vLLM, Together, Fireworks...)',
    commercialOk: true,
    signup: 'https://docs.litellm.ai',
  },
];

type Env = Record<string, string | undefined>;

const BY_ID = new Map(EMBED_PROVIDERS.map((p) => [p.id, p]));
export const embedProviderById = (id: string): EmbedProvider | undefined => BY_ID.get(id);

export function isEmbedConfigured(p: EmbedProvider, env: Env = process.env): boolean {
  return !!env[p.keyEnv] && (p.extraEnv ?? []).every((k) => !!env[k]);
}

// El proveedor `custom` toma modelo y dimensiones del entorno.
export function resolveEmbedProvider(p: EmbedProvider, env: Env = process.env): EmbedProvider | null {
  if (p.id !== 'custom') return p;
  const dims = Number(env.AI_EMBED_CUSTOM_DIMS);
  const model = env.AI_EMBED_CUSTOM_MODEL;
  if (!model || !Number.isInteger(dims) || dims <= 0) return null;
  return { ...p, model, dims, profile: `custom-embed:${model}:${dims}` };
}

export function resolveEmbedBaseUrl(p: EmbedProvider, env: Env = process.env): string | null {
  let missing = false;
  const url = p.baseUrl.replace(/\{([A-Z_]+)\}/g, (_m, name: string) => {
    const v = env[name];
    if (!v) missing = true;
    return v ?? '';
  });
  return missing ? null : url.replace(/\/+$/, '');
}

// Orden por defecto: Gemini primero (ya esta indexado todo con el), luego los que admiten lotes. Se reemplaza con
// EMBED_CHAIN="cloudflare,voyage,gemini" (ids separados por comas).
export const DEFAULT_EMBED_ORDER = ['gemini', 'cloudflare', 'voyage', 'mistral', 'jina', 'custom'];

export function parseEmbedOrder(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((id) => BY_ID.has(id));
}

// Proveedores ACTIVOS (con llave y bien configurados), en orden de preferencia. Jina (solo no comercial) no entra por
// defecto salvo que se pida con EMBED_CHAIN o EMBED_ALLOW_NONCOMMERCIAL=on: evita usar por descuido un nivel gratuito que
// prohibe el uso comercial.
export function embedChain(env: Env = process.env): EmbedProvider[] {
  const fromEnv = parseEmbedOrder(env.EMBED_CHAIN);
  const order = fromEnv.length > 0 ? fromEnv : DEFAULT_EMBED_ORDER;
  const out: EmbedProvider[] = [];
  for (const id of order) {
    const base = BY_ID.get(id);
    if (!base || !isEmbedConfigured(base, env)) continue;
    const p = resolveEmbedProvider(base, env);
    if (!p) continue;
    if (!p.commercialOk && fromEnv.length === 0 && env.EMBED_ALLOW_NONCOMMERCIAL !== 'on') continue;
    out.push(p);
  }
  return out;
}

export function embedProviderForProfile(profile: string, env: Env = process.env): EmbedProvider | null {
  for (const base of EMBED_PROVIDERS) {
    if (!isEmbedConfigured(base, env)) continue;
    const p = resolveEmbedProvider(base, env);
    if (p && p.profile === profile) return p;
  }
  return null;
}
