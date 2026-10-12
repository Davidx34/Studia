import { isOpenRouterConfigured } from '@/lib/ai/openrouter';
import type { AiTask, Candidate } from './types';

// Catalogo de proveedores. Casi todos hablan la API "chat/completions" de OpenAI, asi que UN cliente generico los cubre;
// agregar uno es agregar una fila. Un proveedor esta ACTIVO solo si su(s) variable(s) de entorno existen.
//
// Los limites gratuitos cambian sin aviso (revisados en octubre de 2026 en fuentes de terceros; Google ya no los publica
// por modelo): la columna `free` es orientativa. Lo que cuenta es lo que diga la consola de cada proveedor.

export interface ProviderDef {
  id: string;
  label: string;
  // URL base de la API compatible con OpenAI. Admite {VARIABLE} (se rellena desde el entorno).
  baseUrl: string;
  keyEnv: string;
  extraEnv?: string[];
  jsonMode: boolean; // acepta response_format: { type: 'json_object' }
  tier: 'free' | 'paid' | 'self';
  free: string;
  signup: string;
  // Proveedor con adaptador propio (no usa el cliente generico).
  custom?: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyEnv: 'CEREBRAS_API_KEY',
    jsonMode: true,
    tier: 'free',
    free: '~30 peticiones/min y ~1 M de tokens/dia; muy rapido; sin tarjeta',
    signup: 'https://cloud.cerebras.ai',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    jsonMode: true,
    tier: 'free',
    free: '~30 peticiones/min y ~1.000/dia en los modelos grandes (mas en los pequenos); sin tarjeta',
    signup: 'https://console.groq.com',
  },
  {
    id: 'mistral',
    label: 'Mistral (La Plateforme, plan Experiment)',
    baseUrl: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
    jsonMode: true,
    tier: 'free',
    free: 'plan gratuito con limites por minuto y por mes (se ven en la consola); pide telefono verificado y aceptar uso de datos para entrenar',
    signup: 'https://console.mistral.ai',
  },
  {
    id: 'gemini',
    label: 'Google Gemini (AI Studio)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    jsonMode: true,
    tier: 'free',
    free: 'solo modelos Flash; en esta llave se midieron 20 peticiones/dia en gemini-2.5-flash; sin tarjeta; fuera de UE/UK los prompts pueden usarse para entrenar',
    signup: 'https://aistudio.google.com',
  },
  {
    id: 'github',
    label: 'GitHub Models',
    baseUrl: 'https://models.github.ai/inference',
    keyEnv: 'GITHUB_MODELS_TOKEN',
    jsonMode: true,
    tier: 'free',
    free: '~15 peticiones/min y 150-1.000/dia segun el modelo; contexto reducido; se usa un token personal con permiso "models"',
    signup: 'https://github.com/marketplace/models',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM (build.nvidia.com)',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyEnv: 'NVIDIA_API_KEY',
    jsonMode: false,
    tier: 'free',
    free: 'creditos/limites de prototipado (~1.000 peticiones/dia reportadas); verificacion de cuenta',
    signup: 'https://build.nvidia.com',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1',
    keyEnv: 'CLOUDFLARE_API_TOKEN',
    extraEnv: ['CLOUDFLARE_ACCOUNT_ID'],
    jsonMode: false,
    tier: 'free',
    free: '10.000 "neurons"/dia compartidos entre modelos (se reinicia 00:00 UTC); contexto corto',
    signup: 'https://dash.cloudflare.com',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    jsonMode: false,
    tier: 'free',
    free: 'modelos ":free": 20/min y 50/dia (1.000/dia con >= 10 USD comprados en total); el resto de modelos es de pago por uso',
    signup: 'https://openrouter.ai',
    custom: true, // usa src/lib/ai/openrouter.ts (soporta Vercel Connect y su propia lista de respaldo)
  },
  {
    id: 'openai',
    label: 'OpenAI (de pago)',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    jsonMode: true,
    tier: 'paid',
    free: 'sin nivel gratuito: el dia que haya presupuesto, solo pon la llave y entra en la cadena',
    signup: 'https://platform.openai.com',
  },
  {
    id: 'custom',
    label: 'Compatible con OpenAI (propio)',
    baseUrl: '{AI_CUSTOM_BASE_URL}',
    keyEnv: 'AI_CUSTOM_API_KEY',
    extraEnv: ['AI_CUSTOM_BASE_URL'],
    jsonMode: true,
    tier: 'self',
    free: 'cualquier servicio compatible: un LiteLLM/Portkey propio, Ollama, vLLM, Together, Fireworks, DeepSeek...',
    signup: 'https://docs.litellm.ai',
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));
export const providerById = (id: string): ProviderDef | undefined => BY_ID.get(id);

type Env = Record<string, string | undefined>;

export function isProviderConfigured(p: ProviderDef, env: Env = process.env): boolean {
  if (p.id === 'openrouter') return isOpenRouterConfigured();
  return !!env[p.keyEnv] && (p.extraEnv ?? []).every((k) => !!env[k]);
}

export function resolveBaseUrl(p: ProviderDef, env: Env = process.env): string | null {
  let missing = false;
  const url = p.baseUrl.replace(/\{([A-Z_]+)\}/g, (_m, name: string) => {
    const v = env[name];
    if (!v) missing = true;
    return v ?? '';
  });
  return missing ? null : url.replace(/\/+$/, '');
}

// Cadenas por defecto, en orden de preferencia (calidad/velocidad primero). Los identificadores de modelo cambian con el
// tiempo: se pueden reemplazar por variable de entorno AI_CHAIN_<TAREA> ("proveedor:modelo,proveedor:modelo") y
// `npm run ai:doctor` comprueba cuales siguen existiendo.
export const DEFAULT_CHAINS: Record<AiTask, Candidate[]> = {
  // Generar preguntas/fichas: salida JSON larga, buen espanol, instrucciones largas. Gemini NO entra aqui a proposito: su llave
  // ya sostiene embeddings, juez, lectura de PDF y deteccion de temas con una cuota gratuita pequena.
  generation: [
    { provider: 'cerebras', model: 'gpt-oss-120b' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'mistral', model: 'mistral-small-latest' },
    { provider: 'github', model: 'openai/gpt-4.1-mini' },
    { provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct' },
    { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    { provider: 'openrouter', model: 'auto' },
    { provider: 'openai', model: 'gpt-4.1-mini' },
    { provider: 'custom', model: 'default' },
  ],
  // Juzgar: determinista y de OTRA familia que el generador (Aya/Cohere genera; aqui Llama, gpt-oss, Gemini, Mistral).
  judge: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'cerebras', model: 'gpt-oss-120b' },
    { provider: 'github', model: 'openai/gpt-4.1-mini' },
    { provider: 'mistral', model: 'mistral-small-latest' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct' },
    { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    { provider: 'openrouter', model: 'auto' },
    { provider: 'openai', model: 'gpt-4.1-mini' },
    { provider: 'custom', model: 'default' },
  ],
  // Analizar (temas, dificultad, clasificar): tarea corta y barata, sirve un modelo pequeno y rapido.
  analysis: [
    { provider: 'groq', model: 'llama-3.1-8b-instant' },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
    { provider: 'mistral', model: 'mistral-small-latest' },
    { provider: 'cerebras', model: 'gpt-oss-120b' },
    { provider: 'openrouter', model: 'auto' },
    { provider: 'openai', model: 'gpt-4.1-mini' },
    { provider: 'custom', model: 'default' },
  ],
  study: [
    { provider: 'cerebras', model: 'gpt-oss-120b' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'mistral', model: 'mistral-small-latest' },
    { provider: 'openrouter', model: 'auto' },
    { provider: 'openai', model: 'gpt-4.1-mini' },
    { provider: 'custom', model: 'default' },
  ],
};

// "proveedor:modelo,proveedor:modelo" -> candidatos. Lo invalido se ignora.
export function parseChain(raw: string | undefined): Candidate[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      return i > 0 ? { provider: s.slice(0, i).trim(), model: s.slice(i + 1).trim() } : null;
    })
    .filter((c): c is Candidate => !!c && !!c.model && BY_ID.has(c.provider));
}

// Cadena efectiva de una tarea: la del entorno si existe, si no la de por defecto; y SOLO con proveedores activos.
export function chainFor(task: AiTask, env: Env = process.env): Candidate[] {
  const fromEnv = parseChain(env[`AI_CHAIN_${task.toUpperCase()}`]);
  const base = fromEnv.length > 0 ? fromEnv : DEFAULT_CHAINS[task];
  return base.filter((c) => {
    const p = BY_ID.get(c.provider);
    return !!p && isProviderConfigured(p, env);
  });
}

export function hasProviderFor(task: AiTask, env: Env = process.env): boolean {
  return chainFor(task, env).length > 0;
}
