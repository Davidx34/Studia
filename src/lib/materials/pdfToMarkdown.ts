// PDF -> Markdown: primero se transcribe con un modelo con vision, y solo se usa ese resultado si
// pasa una compuerta de calidad; si no, se cae al texto simple que la app ya usaba.
//
// Medido con los 7 PDFs reales de Microeconomia I (diapositivas): entre 0,1 % y 8,7 % del texto
// extraido eran caracteres basura (las formulas), casi todas las paginas venian rotadas 90 grados y
// habia unos 300-400 caracteres por pagina: el contenido estaba en formulas y graficos que la
// extraccion de texto no puede leer.

import { callPdfVision, type PdfVisionCall } from '@/lib/ai/geminiPdf';
import {
  splitPageRanges,
  buildPdfPrompt,
  cleanModelMarkdown,
  parsePages,
  joinPages,
  sanitizeMarkdown,
  countUnreadableSymbols,
  assessConversion,
} from './pdfMarkdown';

export type ConversionMethod = 'vision_gemini' | 'vision_openrouter' | 'vision_mixed' | 'plain_text';

export interface ConversionReport {
  method: ConversionMethod;
  pages: number;
  pages_found: number;
  word_recall: number | null;
  plain_chars: number;
  markdown_chars: number;
  unreadable_symbols: number;
  vision: { batches: number; failed_batches: number; failures: string[]; providers: string[]; prompt_tokens: number; output_tokens: number };
  fallback_reason: string | null;
  warnings: string[];
}

export interface ConversionResult {
  markdown: string;
  method: ConversionMethod;
  report: ConversionReport;
}

export interface ConvertDeps {
  extractPlain?: (bytes: Uint8Array) => Promise<string[]>;
  vision?: (base64: string, prompt: string, opts: { skipGemini?: boolean; timeoutMs?: number }) => Promise<PdfVisionCall>;
  concurrency?: number;
  // Inyectables para poder probarlo sin esperar de verdad.
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  deadlineMs?: number;
}

// Una funcion de Vercel con Fluid compute llega a 300 s: se deja margen para descargar, trocear y
// calcular embeddings despues de convertir.
export const CONVERSION_DEADLINE_MS = 200_000;
const PER_CALL_TIMEOUT_MS = 90_000;
const RETRY_BACKOFF_MS = [3000, 8000];
const TRANSIENT = new Set(['server', 'timeout', 'rate_limited', 'empty']);

async function defaultExtractPlain(bytes: Uint8Array): Promise<string[]> {
  const { extractText } = await import('unpdf');
  const result = await extractText(bytes, { mergePages: false });
  return Array.isArray(result.text) ? result.text.map(String) : [String(result.text ?? '')];
}

const VISION_FAILURE_TEXT: Record<string, string> = {
  quota: 'se agoto la cuota diaria gratuita de Gemini',
  rate_limited: 'Gemini limito temporalmente las peticiones',
  no_credit: 'OpenRouter exige un saldo minimo de 0,50 USD para leer archivos',
  no_key: 'no hay ningun proveedor de vision configurado',
  server: 'el proveedor de IA fallo o no respondio',
  timeout: 'el proveedor de IA tardo demasiado',
  bad_request: 'el proveedor de IA rechazo el PDF (¿demasiado grande?)',
  empty: 'el proveedor de IA devolvio una respuesta vacia',
};

export function describeVisionFailure(reason: string): string {
  return VISION_FAILURE_TEXT[reason] ?? reason;
}

export async function convertPdfToMarkdown(bytes: Uint8Array, deps: ConvertDeps = {}): Promise<ConversionResult> {
  const extractPlain = deps.extractPlain ?? defaultExtractPlain;
  const vision = deps.vision ?? ((b64, prompt, o) => callPdfVision(b64, prompt, o));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.deadlineMs ?? CONVERSION_DEADLINE_MS);

  // unpdf/pdfjs puede "consumir" el buffer que recibe: se le da una copia.
  const plainPages = await extractPlain(new Uint8Array(bytes));
  const totalPages = plainPages.length;
  if (totalPages === 0) throw new Error('El PDF no tiene paginas.');

  const rawPlain = plainPages.join('\n\n');
  const plainText = sanitizeMarkdown(rawPlain);
  const unreadable = countUnreadableSymbols(rawPlain);
  const scanned = plainText.length < Math.max(50, totalPages * 20);

  // ---- Vision, por tandas de paginas ----
  const base64 = Buffer.from(bytes).toString('base64');
  const ranges = splitPageRanges(totalPages);
  const merged = new Map<number, string>();
  const providers = new Set<string>();
  let promptTokens = 0;
  let outputTokens = 0;
  let failedBatches = 0;
  let lastFailure: string | null = null;
  const failureReasons = new Set<string>();
  let geminiDown = false;

  let next = 0;
  async function worker() {
    while (next < ranges.length) {
      const range = ranges[next++];
      const prompt = buildPdfPrompt(range, totalPages);

      // Los fallos transitorios (503, timeout, limite por minuto) se reintentan con espera, mientras
      // quede tiempo. La cuota diaria agotada NO: reintentar no la arregla.
      let call: PdfVisionCall = { ok: false, reason: 'timeout' };
      for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
        const remaining = deadline - now();
        if (remaining < 15_000) {
          call = { ok: false, reason: 'timeout' };
          break;
        }
        call = await vision(base64, prompt, { skipGemini: geminiDown, timeoutMs: Math.min(PER_CALL_TIMEOUT_MS, remaining) });
        if (call.ok || !TRANSIENT.has(call.reason) || attempt === RETRY_BACKOFF_MS.length) break;
        await sleep(RETRY_BACKOFF_MS[attempt]);
      }

      if (!call.ok) {
        failedBatches++;
        lastFailure = call.reason;
        failureReasons.add(call.reason);
        if (call.reason === 'quota' || call.reason === 'no_key') geminiDown = true;
        continue;
      }
      providers.add(call.provider);
      promptTokens += call.promptTokens ?? 0;
      outputTokens += call.outputTokens ?? 0;
      const { pages } = parsePages(cleanModelMarkdown(call.text));
      // Solo se aceptan las paginas que se pidieron: un numero fuera de rango es una alucinacion.
      pages.forEach((body, n) => {
        if (n >= range.from && n <= range.to) merged.set(n, body);
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 3, ranges.length) }, worker));

  const visionMarkdown = sanitizeMarkdown(joinPages(merged));
  const quality =
    merged.size > 0
      ? assessConversion({ expectedPages: totalPages, pagesFound: merged.size, plainText, markdown: visionMarkdown })
      : null;

  const baseReport = {
    pages: totalPages,
    plain_chars: plainText.length,
    unreadable_symbols: unreadable,
    vision: {
      batches: ranges.length,
      failed_batches: failedBatches,
      failures: Array.from(failureReasons),
      providers: Array.from(providers),
      prompt_tokens: promptTokens,
      output_tokens: outputTokens,
    },
  };

  if (quality?.ok) {
    const method: ConversionMethod =
      providers.size > 1 ? 'vision_mixed' : providers.has('openrouter') ? 'vision_openrouter' : 'vision_gemini';
    return {
      markdown: visionMarkdown,
      method,
      report: {
        ...baseReport,
        method,
        pages_found: merged.size,
        word_recall: quality.recall,
        markdown_chars: visionMarkdown.length,
        fallback_reason: null,
        warnings: failedBatches > 0 ? [`${failedBatches} de ${ranges.length} tandas fallaron; revisa que no falten paginas.`] : [],
      },
    };
  }

  // ---- Respaldo: texto simple ----
  const failure = lastFailure as string | null; // se asigna dentro del worker; TS no lo ve
  const batchCause = failure ? ` (${describeVisionFailure(failure)})` : '';
  const fallbackReason =
    quality && quality.reasons.length > 0
      ? `la conversion no paso el control de calidad: ${quality.reasons.join('; ')}${batchCause}`
      : failure
        ? `no se pudo convertir con IA: ${describeVisionFailure(failure)}`
        : 'no se pudo convertir con IA';

  if (scanned) {
    throw new Error(
      `El PDF parece escaneado (casi no tiene texto seleccionable) y ${fallbackReason}. Intenta de nuevo mas tarde o sube una version con texto.`
    );
  }

  const warnings = [`Se uso el texto simple: ${fallbackReason}.`];
  if (unreadable > 0) {
    warnings.push(`Se perdieron ${unreadable} simbolos que el PDF no permite leer como texto (probablemente formulas) y los graficos no se incluyen.`);
  }
  return {
    markdown: plainText,
    method: 'plain_text',
    report: {
      ...baseReport,
      method: 'plain_text',
      pages_found: merged.size,
      word_recall: quality?.recall ?? null,
      markdown_chars: plainText.length,
      fallback_reason: fallbackReason,
      warnings,
    },
  };
}
