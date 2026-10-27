// Lectura de un PDF con vision: Gemini (cuota gratuita) y, si no puede, OpenRouter.
//
// Por que existe: la extraccion de texto de un PDF (unpdf) pierde lo que no es texto: en las
// diapositivas reales de Microeconomia I las formulas salian como caracteres basura y los
// graficos no salian. Un modelo con vision lee la pagina como la ve una persona.
//
// Medido el 2026-09-19 con un PDF real de 10 paginas: 11 s, ~2.700 tokens de entrada
// (~258 por pagina) y ~900 de salida.

import { callOpenRouter, isOpenRouterConfigured } from '@/lib/ai/openrouter';
import { DEFAULT_MODELS, geminiModels } from '@/lib/ai/geminiModels';
import { geminiGenerate } from '@/lib/ai/geminiDirect';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export type PdfVisionFailure = 'no_key' | 'quota' | 'rate_limited' | 'no_credit' | 'server' | 'bad_request' | 'timeout' | 'empty';

export type PdfVisionCall =
  | { ok: true; text: string; provider: 'gemini' | 'openrouter'; model: string; promptTokens?: number; outputTokens?: number }
  | { ok: false; reason: PdfVisionFailure; status?: number };

export interface PdfVisionOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

// Gemini 429 con "PerDay": la cuota diaria, que reintentar no arregla.
export function isGeminiDailyQuota(status: number, body: string): boolean {
  return status === 429 && /PerDay/i.test(body);
}

// Modelos de Gemini para leer PDFs, en orden. El primero tiene su PROPIA cuota: el juez usa
// gemini-2.5-flash y su cuota gratuita (20 peticiones al dia) se agota con unas pocas conversiones,
// porque cada tanda de un PDF consume una. Se puede cambiar con GEMINI_PDF_MODELS (lista con comas).
export const DEFAULT_GEMINI_PDF_MODELS = DEFAULT_MODELS.free.pdf;
export function geminiPdfModels(): string[] {
  return geminiModels('pdf'); // GEMINI_MODEL_PDF o GEMINI_PDF_MODELS, o el perfil (AI_PROFILE)
}

// Lee el PDF con Gemini por geminiGenerate (src/lib/ai/geminiDirect.ts): prueba los modelos de PDF y, si uno no esta disponible (404),
// sin cuota o saturado, el siguiente. Un 404 YA NO se toma por "peticion invalida": antes cortaba aqui y ni siquiera se probaba OpenRouter.
export async function callGeminiPdf(base64: string, prompt: string, opts: PdfVisionOptions = {}): Promise<PdfVisionCall> {
  if (!process.env.GEMINI_API_KEY) return { ok: false, reason: 'no_key' };

  const r = await geminiGenerate({
    role: 'pdf',
    parts: [{ inline_data: { mime_type: 'application/pdf', data: base64 } }, { text: prompt }],
    // temperature 0: es una transcripcion, no una redaccion. El "pensar" interno se apaga (geminiGenerate lo hace por modelo): se
    // comeria el presupuesto de salida y truncaria el Markdown.
    generationConfig: { temperature: 0, maxOutputTokens: opts.maxOutputTokens ?? 16000 },
    retries: 0,
    maxBadRequestModels: 1, // un PDF demasiado grande no lo arregla otro modelo
    timeoutMs: opts.timeoutMs ?? 120_000,
    fetchImpl: opts.fetchImpl,
  });
  if (r.ok) return { ok: true, text: r.text, provider: 'gemini', model: r.model, promptTokens: r.usage.prompt, outputTokens: r.usage.output };

  switch (r.reason) {
    case 'quota_daily': return { ok: false, reason: 'quota', status: 429 };
    case 'rate_limited': return { ok: false, reason: 'rate_limited', status: 429 };
    case 'timeout': return { ok: false, reason: 'timeout' };
    case 'bad_request': return { ok: false, reason: 'bad_request', status: r.status };
    case 'empty': return { ok: false, reason: 'empty' };
    case 'no_key':
    case 'auth': return { ok: false, reason: 'no_key', status: r.status };
    default: return { ok: false, reason: 'server', status: r.status }; // server y model_unavailable: callPdfVision sigue con OpenRouter
  }
}

export async function callOpenRouterPdf(base64: string, prompt: string, opts: PdfVisionOptions = {}): Promise<PdfVisionCall> {
  if (!isOpenRouterConfigured()) return { ok: false, reason: 'no_key' };
  const r = await callOpenRouter(prompt, {
    role: 'pdf',
    maxTokens: opts.maxOutputTokens ?? 16000,
    timeoutMs: opts.timeoutMs ?? 120_000,
    retries: 0,
    fetchImpl: opts.fetchImpl,
    attachment: { filename: 'documento.pdf', dataUrl: `data:application/pdf;base64,${base64}` },
  });
  if (r.ok) return { ok: true, text: r.text, provider: 'openrouter', model: r.model };
  // 402: OpenRouter pide un saldo minimo para archivos.
  if (r.status === 402) return { ok: false, reason: 'no_credit', status: 402 };
  const reason: PdfVisionFailure =
    r.reason === 'rate_limited' ? 'rate_limited'
    : r.reason === 'no_key' || r.reason === 'unauthorized' ? 'no_key'
    : r.reason === 'timeout' ? 'timeout'
    : r.reason === 'empty' ? 'empty'
    : r.reason === 'bad_request' ? 'bad_request'
    : 'server';
  return { ok: false, reason, status: r.status };
}

// Gemini primero (cuota gratuita); OpenRouter (de pago) solo si Gemini no puede.
export async function callPdfVision(base64: string, prompt: string, opts: PdfVisionOptions & { skipGemini?: boolean } = {}): Promise<PdfVisionCall> {
  if (!opts.skipGemini) {
    const g = await callGeminiPdf(base64, prompt, opts);
    if (g.ok) return g;
    // Un 4xx propio de esta peticion (p.ej. PDF demasiado grande) no lo arregla otro proveedor.
    if (g.reason === 'bad_request') return g;
    const o = await callOpenRouterPdf(base64, prompt, opts);
    return o.ok ? o : g.reason === 'no_key' ? o : g; // se reporta la causa del proveedor principal
  }
  return callOpenRouterPdf(base64, prompt, opts);
}
