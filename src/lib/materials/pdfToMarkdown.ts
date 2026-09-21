// PDF -> Markdown, HIBRIDO: lo que se puede hacer sin IA se hace sin IA.
//
//   1. pdfExtract: TODAS las paginas se convierten de forma determinista (titulos, listas, acentos,
//      encabezados repetidos) y se clasifican. Gratis e instantaneo.
//   2. Solo las paginas de RIESGO (formulas ilegibles, imagenes grandes, dibujos, tablas) se recortan
//      del PDF (pdfSlice) y se mandan a un modelo con vision. Un PDF de texto no llama a ninguna IA.
//   3. pdfVerify comprueba CADA pagina transcrita (LaTeX valido, simbolos, numeros, palabras). Si una
//      no pasa, esa pagina se queda con el texto determinista. Nunca se guarda una transcripcion dudosa
//      y no se le pide nada al profesor.
//
// Medido con 7 presentaciones reales de Microeconomia I (232 paginas): el 75 % eran de riesgo; en
// documentos de texto la proporcion es minima. Con el recorte, cada pagina se envia una sola vez (antes
// cada tanda reenviaba el PDF completo: ~5 veces el tamaño real).

import { callPdfVision, type PdfVisionCall } from '@/lib/ai/geminiPdf';
import { readPdfPages, type PageData } from './pdfExtract';
import { slicePdf } from './pdfSlice';
import { verifyPage, defaultLatexRenderer, type LatexRenderer } from './pdfVerify';
import { buildPdfPrompt, buildPdfPagesPrompt, cleanModelMarkdown, parsePages, sanitizeMarkdown, PAGES_PER_BATCH } from './pdfMarkdown';

// 'deterministic': sin IA (o la IA no aporto nada). 'hybrid': al menos una pagina transcrita por IA y verificada.
export type ConversionMethod = 'deterministic' | 'hybrid';

export interface ConversionReport {
  method: ConversionMethod;
  pages: number;
  risky_pages: number;
  ai_pages_accepted: number;
  ai_pages_rejected: { page: number; reasons: string[] }[];
  ai_pages_missing: number[];
  unreadable_symbols: number;
  vision: { batches: number; failed_batches: number; failures: string[]; providers: string[]; prompt_tokens: number; output_tokens: number; sliced: boolean };
  fallback_reason: string | null;
  warnings: string[];
}

export interface ConversionResult {
  markdown: string;
  method: ConversionMethod;
  report: ConversionReport;
}

export interface ConvertDeps {
  readPages?: (bytes: Uint8Array) => Promise<PageData[]>;
  slice?: (bytes: Uint8Array, pageNumbers: number[]) => Promise<Uint8Array>;
  vision?: (base64: string, prompt: string, opts: { skipGemini?: boolean; timeoutMs?: number }) => Promise<PdfVisionCall>;
  render?: LatexRenderer;
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
const MAX_REJECTED_IN_REPORT = 30;

const VISION_FAILURE_TEXT: Record<string, string> = {
  quota: 'se agoto la cuota diaria gratuita de Gemini',
  rate_limited: 'Gemini limito temporalmente las peticiones',
  no_credit: 'OpenRouter exige un saldo minimo de 0,50 USD para leer archivos',
  no_key: 'no hay ningun proveedor de vision configurado',
  server: 'el proveedor de IA fallo o no respondio',
  timeout: 'el proveedor de IA tardo demasiado',
  bad_request: 'el proveedor de IA rechazo el PDF',
  empty: 'el proveedor de IA devolvio una respuesta vacia',
};

export function describeVisionFailure(reason: string): string {
  return VISION_FAILURE_TEXT[reason] ?? reason;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function convertPdfToMarkdown(bytes: Uint8Array, deps: ConvertDeps = {}): Promise<ConversionResult> {
  const readPages = deps.readPages ?? readPdfPages;
  const slice = deps.slice ?? slicePdf;
  const vision = deps.vision ?? ((b64, prompt, o) => callPdfVision(b64, prompt, o));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.deadlineMs ?? CONVERSION_DEADLINE_MS);

  // ---- 1. Todo, determinista ----
  const pages = await readPages(new Uint8Array(bytes)); // pdfjs puede consumir el buffer: se le da una copia
  if (pages.length === 0) throw new Error('El PDF no tiene paginas.');
  const byNumber = new Map<number, PageData>();
  pages.forEach((p) => byNumber.set(p.number, p));
  const risky = pages.filter((p) => p.risk.length > 0);
  const totalChars = pages.reduce((n, p) => n + p.chars, 0);
  const unreadable = pages.reduce((n, p) => n + p.unreadable, 0);

  // ---- 2. IA solo en las paginas de riesgo ----
  const accepted = new Map<number, string>();
  const rejected: { page: number; reasons: string[] }[] = [];
  const answered = new Set<number>();
  const providers = new Set<string>();
  const failureReasons = new Set<string>();
  let promptTokens = 0;
  let outputTokens = 0;
  let failedBatches = 0;
  let lastFailure: string | null = null;
  let geminiDown = false;
  let usedSlicing = true;

  const batches = chunk(
    risky.map((p) => p.number),
    PAGES_PER_BATCH
  );

  if (batches.length > 0) {
    const render = deps.render ?? (await defaultLatexRenderer());
    let next = 0;

    const worker = async () => {
      while (next < batches.length) {
        const batchPages = batches[next++];

        // Recorte: el modelo recibe solo estas paginas. Si el recorte falla se manda el PDF completo pidiendo
        // esas paginas por su numero.
        let payload: Uint8Array = bytes;
        let sliced = true;
        try {
          payload = await slice(bytes, batchPages);
        } catch {
          sliced = false;
          usedSlicing = false;
        }
        const base64 = Buffer.from(payload).toString('base64');
        const prompt = sliced ? buildPdfPrompt({ from: 1, to: batchPages.length }, batchPages.length) : buildPdfPagesPrompt(batchPages, pages.length);

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

        const parsed = parsePages(cleanModelMarkdown(call.text)).pages;
        parsed.forEach((md, marker) => {
          // El marcador es la posicion dentro del recorte (o el numero real si se mando el PDF completo).
          const original = sliced ? batchPages[marker - 1] : marker;
          if (original === undefined || !batchPages.includes(original)) return; // numero inventado
          answered.add(original);
          const page = byNumber.get(original)!;
          // ---- 3. Verificacion automatica de cada pagina ----
          const verdict = verifyPage(page.text, md, render);
          if (verdict.ok) accepted.set(original, md);
          else rejected.push({ page: original, reasons: verdict.reasons });
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 3, batches.length) }, worker));
  }

  // ---- 4. Ensamblado: la transcripcion verificada o, si no, el texto determinista ----
  const markdown = sanitizeMarkdown(
    pages
      .map((p) => accepted.get(p.number) ?? p.markdown)
      .filter((m) => m.trim().length > 0)
      .join('\n\n')
  );

  const missing = risky.map((p) => p.number).filter((n) => !answered.has(n));
  const failure = lastFailure as string | null; // se asigna dentro del worker; TS no lo ve
  const warnings: string[] = [];
  const stillRisky = risky.length - accepted.size;
  let fallbackReason: string | null = null;

  if (risky.length > 0 && accepted.size === 0) {
    const cause = failure ? describeVisionFailure(failure) : rejected.length > 0 ? 'ninguna transcripcion paso la verificacion' : 'sin respuesta';
    fallbackReason = `no se pudo usar la IA en las ${risky.length} paginas con formulas o graficos: ${cause}`;
  }

  // Un PDF escaneado (casi sin texto) que la IA no pudo leer no sirve: mejor un error claro que un material vacio.
  if (totalChars < Math.max(50, pages.length * 20) && accepted.size === 0) {
    throw new Error(
      `El PDF parece escaneado (casi no tiene texto seleccionable) y ${fallbackReason ?? 'no se pudo leer con IA'}. Intenta de nuevo mas tarde o sube una version con texto.`
    );
  }

  if (stillRisky > 0) {
    warnings.push(
      `${stillRisky} de ${risky.length} paginas con formulas o graficos quedaron como texto simple` +
        (rejected.length > 0 ? ` (${rejected.length} no pasaron la verificacion automatica)` : '') +
        (failedBatches > 0 && failure ? ` (${describeVisionFailure(failure)})` : '') +
        '.'
    );
  }
  // Solo cuentan los simbolos de las paginas que NO se transcribieron: en las demas la IA ya los leyo.
  const unreadableLeft = pages.filter((p) => !accepted.has(p.number)).reduce((n, p) => n + p.unreadable, 0);
  if (unreadableLeft > 0) {
    warnings.push(`Hay ${unreadableLeft} simbolos que el PDF no permite leer como texto (probablemente formulas) sin transcribir.`);
  }

  const method: ConversionMethod = accepted.size > 0 ? 'hybrid' : 'deterministic';
  return {
    markdown,
    method,
    report: {
      method,
      pages: pages.length,
      risky_pages: risky.length,
      ai_pages_accepted: accepted.size,
      ai_pages_rejected: rejected.slice(0, MAX_REJECTED_IN_REPORT),
      ai_pages_missing: missing.slice(0, MAX_REJECTED_IN_REPORT),
      unreadable_symbols: unreadable,
      vision: {
        batches: batches.length,
        failed_batches: failedBatches,
        failures: Array.from(failureReasons),
        providers: Array.from(providers),
        prompt_tokens: promptTokens,
        output_tokens: outputTokens,
        sliced: usedSlicing,
      },
      fallback_reason: fallbackReason,
      warnings,
    },
  };
}
