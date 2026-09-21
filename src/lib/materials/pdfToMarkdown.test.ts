import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { convertPdfToMarkdown, describeVisionFailure } from './pdfToMarkdown';
import type { PageData } from './pdfExtract';
import type { PdfVisionCall } from '@/lib/ai/geminiPdf';

// Render de LaTeX simulado: acepta todo salvo lo que contenga "ROTO".
const render = (expr: string) => {
  if (expr.includes('ROTO')) throw new Error('LaTeX invalido');
};

// Una pagina con texto suficiente para que las verificaciones puedan comparar.
function pageData(n: number, opts: Partial<PageData> = {}): PageData {
  const text = `pagina${n} elasticidad demanda consumidor restriccion presupuestaria utilidad marginal optimo canasta`;
  return { number: n, markdown: `## Diapositiva ${n}\n\n${text}`, text, chars: text.length, unreadable: 0, risk: [], ...opts };
}
const risky = (n: number): PageData => pageData(n, { unreadable: 2, risk: ['formulas_ilegibles'] });

// Un "modelo con vision" que transcribe fielmente las paginas del recorte que recibe.
// El recorte se simula: el "PDF" que recibe es un JSON con los numeros de pagina.
function fakeSlice(_bytes: Uint8Array, pageNumbers: number[]) {
  return Promise.resolve(new TextEncoder().encode(JSON.stringify(pageNumbers)));
}
function faithful(pages: PageData[]) {
  return vi.fn(async (b64: string): Promise<PdfVisionCall> => {
    const nums: number[] = JSON.parse(Buffer.from(b64, 'base64').toString());
    const text = nums
      .map((n, i) => `[[PAGINA ${i + 1}]]\n## IA ${n}\n\n${pages.find((p) => p.number === n)!.text} $\\alpha$`)
      .join('\n\n');
    return { ok: true, text: `Aqui tienes:\n\n${text}`, provider: 'gemini', model: 'gemini-2.5-flash-lite', promptTokens: 100, outputTokens: 50 };
  });
}

const noSleep = async () => {};
const bytes = new Uint8Array([37, 80, 68, 70]);
const base = { slice: fakeSlice, render, sleep: noSleep };

describe('convertPdfToMarkdown (hibrido)', () => {
  it('un PDF de texto NO llama a ninguna IA: conversion determinista', async () => {
    const pages = [pageData(1), pageData(2), pageData(3)];
    const vision = vi.fn();
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision });
    expect(vision).not.toHaveBeenCalled();
    expect(r.method).toBe('deterministic');
    expect(r.markdown).toContain('## Diapositiva 1');
    expect(r.report).toMatchObject({ pages: 3, risky_pages: 0, ai_pages_accepted: 0, warnings: [] });
  });

  it('solo las paginas de riesgo van a la IA, y el resto queda determinista', async () => {
    const pages = [pageData(1), risky(2), pageData(3), risky(4)];
    const vision = faithful(pages);
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision });
    expect(vision).toHaveBeenCalledTimes(1);
    const sent: number[] = JSON.parse(Buffer.from(vision.mock.calls[0][0] as string, 'base64').toString());
    expect(sent).toEqual([2, 4]); // el recorte solo lleva las paginas de riesgo
    expect(r.method).toBe('hybrid');
    expect(r.markdown).toContain('## Diapositiva 1'); // determinista
    expect(r.markdown).toContain('## IA 2'); // transcrita
    expect(r.markdown).toContain('## Diapositiva 3');
    expect(r.markdown).toContain('## IA 4');
    expect(r.markdown).not.toContain('[[PAGINA');
    expect(r.markdown).not.toContain('Aqui tienes');
    expect(r.report).toMatchObject({ risky_pages: 2, ai_pages_accepted: 2 });
    expect(r.report.vision.sliced).toBe(true);
  });

  it('las paginas de riesgo se agrupan en tandas de PAGES_PER_BATCH', async () => {
    const pages = Array.from({ length: 23 }, (_, i) => risky(i + 1));
    const vision = faithful(pages);
    await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision });
    expect(vision).toHaveBeenCalledTimes(3); // 10 + 10 + 3
  });

  it('REGRESION: una pagina cuya transcripcion NO pasa la verificacion vuelve al texto determinista', async () => {
    // Asi se colaba la tabla mal transcrita: ahora una transcripcion con LaTeX roto se descarta.
    const pages = [risky(1), risky(2)];
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({
      ok: true,
      provider: 'gemini',
      model: 'm',
      text: `[[PAGINA 1]]\n${pages[0].text} $\\alpha$\n\n[[PAGINA 2]]\n${pages[1].text} $ROTO$`,
    }));
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision });
    expect(r.method).toBe('hybrid');
    expect(r.report.ai_pages_accepted).toBe(1);
    expect(r.report.ai_pages_rejected).toEqual([{ page: 2, reasons: [expect.stringMatching(/LaTeX/)] }]);
    expect(r.markdown).not.toContain('ROTO');
    expect(r.markdown).toContain('## Diapositiva 2'); // texto determinista de esa pagina
    expect(r.report.warnings.join(' ')).toMatch(/no pasaron la verificacion/);
  });

  it('una transcripcion que resume y pierde palabras se rechaza', async () => {
    const pages = [risky(1)];
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: true, provider: 'gemini', model: 'm', text: '[[PAGINA 1]]\nResumen breve' }));
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision });
    expect(r.method).toBe('deterministic');
    expect(r.report.ai_pages_rejected).toHaveLength(1);
  });

  it('un marcador fuera del recorte se descarta (numero inventado)', async () => {
    const pages = [risky(1)];
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({
      ok: true,
      provider: 'gemini',
      model: 'm',
      text: `[[PAGINA 1]]\n${pages[0].text} $\\alpha$\n\n[[PAGINA 99]]\ncontenido inventado`,
    }));
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision });
    expect(r.markdown).not.toContain('inventado');
  });

  it('si la IA no responde (cuota) todo queda determinista, con el motivo, sin error', async () => {
    const pages = [pageData(1), risky(2)];
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: false, reason: 'quota', status: 429 }));
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision });
    expect(r.method).toBe('deterministic');
    expect(r.markdown).toContain('## Diapositiva 2');
    expect(r.report.fallback_reason).toMatch(/cuota diaria/);
    expect(r.report.warnings.join(' ')).toMatch(/texto simple/);
    expect(vision).toHaveBeenCalledTimes(1); // la cuota agotada no se reintenta
  });

  it('un fallo transitorio (503) se reintenta y se recupera', async () => {
    const pages = [risky(1)];
    const good = faithful(pages);
    let n = 0;
    const vision = vi.fn(async (b64: string, prompt: string, o: object): Promise<PdfVisionCall> =>
      n++ === 0 ? { ok: false, reason: 'server', status: 503 } : good(b64)
    );
    const sleep = vi.fn(noSleep);
    const r = await convertPdfToMarkdown(bytes, { ...base, sleep, readPages: async () => pages, vision });
    expect(r.method).toBe('hybrid');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('respeta el plazo total: sin tiempo no llama a la IA', async () => {
    const pages = [risky(1)];
    const vision = vi.fn();
    let t = 0;
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision, now: () => (t += 100_000), deadlineMs: 10_000 });
    expect(vision).not.toHaveBeenCalled();
    expect(r.method).toBe('deterministic');
  });

  it('si el recorte del PDF falla, manda el PDF completo pidiendo las paginas por numero', async () => {
    const pages = [pageData(1), risky(2), pageData(3), risky(4)];
    const vision = vi.fn(async (_b64: string, prompt: string): Promise<PdfVisionCall> => ({
      ok: true,
      provider: 'gemini',
      model: 'm',
      text: `[[PAGINA 2]]\n${pages[1].text} $\\alpha$\n\n[[PAGINA 4]]\n${pages[3].text} $\\alpha$`,
    }));
    const r = await convertPdfToMarkdown(bytes, {
      ...base,
      slice: async () => {
        throw new Error('pdf-lib no pudo');
      },
      readPages: async () => pages,
      vision,
    });
    const prompt = vision.mock.calls[0][1] as string;
    expect(prompt).toContain('SOLO estas paginas: 2, 4');
    expect(r.report.vision.sliced).toBe(false);
    expect(r.report.ai_pages_accepted).toBe(2);
  });

  it('una pagina cuyo texto tenia formulas ilegibles avisa cuando queda sin transcribir', async () => {
    const pages = [risky(1)];
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: false, reason: 'server', status: 503 }));
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision });
    expect(r.report.warnings.join(' ')).toMatch(/simbolos que el PDF no permite leer/);
  });

  it('el aviso de simbolos ilegibles cuenta solo las paginas que NO se transcribieron', async () => {
    // 1 pagina transcrita (con 2 simbolos ilegibles ya leidos por la IA) y 1 rechazada (con 3 sin leer).
    const pages = [risky(1), pageData(2, { unreadable: 3, risk: ['formulas_ilegibles'] })];
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({
      ok: true,
      provider: 'gemini',
      model: 'm',
      text: `[[PAGINA 1]]
${pages[0].text} $\alpha$

[[PAGINA 2]]
${pages[1].text} $ROTO$`,
    }));
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => pages, vision });
    expect(r.report.warnings.join(' ')).toMatch(/Hay 3 simbolos/);
    expect(r.report.warnings.join(' ')).not.toMatch(/Hay 5 simbolos/);
  });

  it('un PDF escaneado (sin texto) que la IA no puede leer da un error claro, no un material vacio', async () => {
    const scanned = [1, 2, 3].map((n) => pageData(n, { markdown: '', text: '', chars: 0, risk: ['imagen'] }));
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: false, reason: 'quota', status: 429 }));
    await expect(convertPdfToMarkdown(bytes, { ...base, readPages: async () => scanned, vision })).rejects.toThrow(/escaneado/);
  });

  it('un PDF escaneado que la IA SI puede leer se convierte', async () => {
    const scanned = [pageData(1, { markdown: '', text: '', chars: 0, risk: ['imagen'] })];
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({
      ok: true,
      provider: 'gemini',
      model: 'm',
      text: '[[PAGINA 1]]\n# Titulo\n\nContenido leido de la imagen escaneada con suficiente texto para pasar.',
    }));
    const r = await convertPdfToMarkdown(bytes, { ...base, readPages: async () => scanned, vision });
    expect(r.method).toBe('hybrid');
    expect(r.markdown).toContain('Contenido leido');
  });

  it('un PDF sin paginas es un error', async () => {
    await expect(convertPdfToMarkdown(bytes, { ...base, readPages: async () => [] })).rejects.toThrow(/sin paginas|no tiene paginas/i);
  });

  it('describeVisionFailure explica el saldo minimo de OpenRouter', () => {
    expect(describeVisionFailure('no_credit')).toMatch(/0,50/);
  });
});

const read = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g'), String.fromCharCode(10));

describe('cableado', () => {
  const actions = read('src/lib/actions/materials.ts');

  it('subir un PDF lo procesa con processPdfMaterial; Word/Excel siguen por la edge function', () => {
    expect(actions).toMatch(/input\.mimeType === PDF_MIME[\s\S]*processPdfMaterial\(supabase, data\.id\)/);
    expect(actions).toMatch(/else \{[\s\S]*functions[\s\S]*process-material/);
  });

  it('reprocesar un PDF usa el mismo camino y no borra los chunks antes de tener los nuevos', () => {
    expect(actions).toContain('isPdfFile');
    expect(actions).toMatch(/!isPdfFile\) \{\s*await supabase\.from\('material_chunks'\)\.delete\(\)/);
    expect(actions).toMatch(/else if \(isPdfFile\) \{\s*await processPdfMaterial\(supabase, materialId\)/);
  });

  it('la pagina de materiales declara maxDuration (una presentacion larga tarda 1-3 minutos)', () => {
    const page = read('src/app/(teacher)/teacher/classrooms/[id]/materials/page.tsx');
    expect(Number(page.match(/export const maxDuration = (\d+)/)![1])).toBeGreaterThanOrEqual(120);
  });

  it('las migraciones 048 y 049 y los tipos generados tienen las columnas y los metodos de extraccion', () => {
    const m48 = read('supabase/migrations/048_teaching_materials_extraction.sql');
    expect(m48).toContain('extraction_method');
    expect(m48).toContain('extraction_report');
    const m49 = read('supabase/migrations/049_extraction_method_hybrid.sql');
    expect(m49).toMatch(/'deterministic'[\s\S]*'hybrid'/);
    expect(m49).toContain("'vision_gemini'"); // los materiales ya procesados siguen siendo validos
    const types = read('src/types/database.generated.ts');
    expect(types).toContain('extraction_method: string | null');
    expect(types).toContain('extraction_report?: Json | null');
  });

  it('processPdf usa el mismo pipeline que enlaces y YouTube y guarda el metodo y el informe', () => {
    const src = read('src/lib/materials/processPdf.ts');
    expect(src).toContain('chunkEmbedAndStore(');
    expect(src).toContain('extraction_method: converted.method');
    expect(src).toContain('extraction_report: converted.report');
  });

  it('el orquestador usa las tres capas: determinista, recorte y verificacion', () => {
    const src = read('src/lib/materials/pdfToMarkdown.ts');
    expect(src).toContain('readPdfPages');
    expect(src).toContain('slicePdf');
    expect(src).toContain('verifyPage(');
  });
});
