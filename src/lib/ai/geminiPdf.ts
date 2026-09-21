// Lectura de un PDF con vision: Gemini (cuota gratuita) y, si no puede, OpenRouter.
//
// Por que existe: la extraccion de texto de un PDF (unpdf) pierde lo que no es texto: en las
// diapositivas reales de Microeconomia I las formulas salian como caracteres basura y los
// graficos no salian. Un modelo con vision lee la pagina como la ve una persona.
//
// Medido el 2026-09-19 con un PDF real de 10 paginas: 11 s, ~2.700 tokens de entrada
// (~258 por pagina) y ~900 de salida.

import { callOpenRouter, isOpenRouterConfigured } from '@/lib/ai/openrouter';

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
export const DEFAULT_GEMINI_PDF_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
export function geminiPdfModels(): string[] {
  const fromEnv = (process.env.GEMINI_PDF_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_GEMINI_PDF_MODELS;
}

async function callGeminiPdfModel(model: string, apiKey: string, base64: string, prompt: string, opts: PdfVisionOptions): Promise<PdfVisionCall> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: base64 } }, { text: prompt }] }],
        // temperature 0: es una transcripcion, no una redaccion. thinkingBudget 0: el "pensar" interno
        // se comeria el presupuesto de salida y truncaria el Markdown.
        generationConfig: { temperature: 0, maxOutputTokens: opts.maxOutputTokens ?? 16000, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });

    if (!res.ok) {
      const body = await res.text();
      if (isGeminiDailyQuota(res.status, body)) return { ok: false, reason: 'quota', status: 429 };
      if (res.status === 429) return { ok: false, reason: 'rate_limited', status: 429 };
      if (res.status >= 500) return { ok: false, reason: 'server', status: res.status };
      return { ok: false, reason: 'bad_request', status: res.status };
    }

    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
    if (!text.trim()) return { ok: false, reason: 'empty' };
    return {
      ok: true,
      text,
      provider: 'gemini',
      model,
      promptTokens: data?.usageMetadata?.promptTokenCount,
      outputTokens: data?.usageMetadata?.candidatesTokenCount,
    };
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'server' };
  }
}

// Prueba los modelos de Gemini en orden. Si uno agota su cuota o falla, sigue con el siguiente. Un 4xx
// propio de la peticion (PDF demasiado grande) no lo arregla otro modelo.
export async function callGeminiPdf(base64: string, prompt: string, opts: PdfVisionOptions = {}): Promise<PdfVisionCall> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no_key' };

  let last: PdfVisionCall = { ok: false, reason: 'server' };
  let transient: PdfVisionCall | null = null;
  for (const model of geminiPdfModels()) {
    const r = await callGeminiPdfModel(model, apiKey, base64, prompt, opts);
    if (r.ok || r.reason === 'bad_request') return r;
    last = r;
    if (!transient && (r.reason === 'server' || r.reason === 'timeout' || r.reason === 'rate_limited')) transient = r;
  }
  // Si un modelo estaba SOBRECARGADO (reintentable) y el otro sin cuota, la causa que importa es la
  // primera: reportar "sin cuota" haria que el llamador no reintentara algo que si puede funcionar.
  return transient ?? last;
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
