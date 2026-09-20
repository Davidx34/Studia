import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { convertPdfToMarkdown, describeVisionFailure } from './pdfToMarkdown';
import type { PdfVisionCall } from '@/lib/ai/geminiPdf';

const words = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}termino`).join(' ');

// Texto simple: una cadena por pagina.
function plainPages(n: number, wordsPerPage = 12): string[] {
  return Array.from({ length: n }, (_, p) => words(wordsPerPage, `pag${p + 1}x`));
}

// Un "modelo con vision" que transcribe fielmente las paginas pedidas.
function faithfulVision(pages: string[]) {
  return vi.fn(async (_b64: string, prompt: string): Promise<PdfVisionCall> => {
    const m = prompt.match(/paginas (\d+) a (\d+)/);
    const from = m ? Number(m[1]) : 1;
    const to = m ? Number(m[2]) : pages.length;
    const text = pages
      .slice(from - 1, to)
      .map((t, i) => `[[PAGINA ${from + i}]]\n## Diapositiva ${from + i}\n\n${t}`)
      .join('\n\n');
    return { ok: true, text: `Aqui tienes la transcripcion:\n\n${text}`, provider: 'gemini', model: 'gemini-2.5-flash-lite', promptTokens: 100, outputTokens: 50 };
  });
}

const noSleep = async () => {};
const bytes = new Uint8Array([37, 80, 68, 70]);

describe('convertPdfToMarkdown', () => {
  it('camino feliz: usa la transcripcion de la IA y la reporta', async () => {
    const pages = plainPages(5);
    const vision = faithfulVision(pages);
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision, sleep: noSleep });
    expect(r.method).toBe('vision_gemini');
    expect(r.markdown).toContain('## Diapositiva 1');
    expect(r.markdown).not.toContain('[[PAGINA');
    expect(r.markdown).not.toContain('Aqui tienes'); // la cortesia del modelo se quita
    expect(r.report).toMatchObject({ pages: 5, pages_found: 5, fallback_reason: null, warnings: [] });
    expect(r.report.vision.prompt_tokens).toBe(100);
  });

  it('un PDF largo se transcribe por tandas y se une en orden', async () => {
    const pages = plainPages(47);
    const vision = faithfulVision(pages);
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision, sleep: noSleep });
    expect(vision).toHaveBeenCalledTimes(5); // 10 + 10 + 10 + 10 + 7
    expect(r.report.pages_found).toBe(47);
    const first = r.markdown.indexOf('Diapositiva 1\n');
    const last = r.markdown.indexOf('Diapositiva 47');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(last).toBeGreaterThan(first);
  });

  it('REGRESION: una tanda falla (cuota) -> NO se guarda un Markdown a medias: cae al texto simple con el motivo', async () => {
    // Asi fallo el PDF real de 47 paginas: solo se transcribieron 25 y se habria guardado incompleto.
    const pages = plainPages(47);
    const ok = faithfulVision(pages);
    const vision = vi.fn(async (b64: string, prompt: string): Promise<PdfVisionCall> => {
      if (prompt.includes('paginas 11 a 20') || prompt.includes('paginas 21 a 30')) return { ok: false, reason: 'quota', status: 429 };
      return ok(b64, prompt);
    });
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision, sleep: noSleep });
    expect(r.method).toBe('plain_text');
    expect(r.report.fallback_reason).toMatch(/control de calidad/);
    expect(r.report.fallback_reason).toMatch(/cuota diaria/);
    expect(r.report.vision.failures).toContain('quota');
    expect(r.markdown).toContain('pag1xtermino'.slice(0, 5)); // es el texto simple
  });

  it('un fallo transitorio (503) se reintenta y se recupera', async () => {
    const pages = plainPages(4);
    const good = faithfulVision(pages);
    let n = 0;
    const vision = vi.fn(async (b64: string, prompt: string): Promise<PdfVisionCall> =>
      n++ === 0 ? { ok: false, reason: 'server', status: 503 } : good(b64, prompt)
    );
    const sleep = vi.fn(noSleep);
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision, sleep });
    expect(r.method).toBe('vision_gemini');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(vision).toHaveBeenCalledTimes(2);
  });

  it('la cuota diaria agotada NO se reintenta', async () => {
    const pages = plainPages(4);
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: false, reason: 'quota', status: 429 }));
    const sleep = vi.fn(noSleep);
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision, sleep });
    expect(vision).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(r.method).toBe('plain_text');
  });

  it('respeta el plazo total: sin tiempo no se llama a la IA y se cae al texto simple', async () => {
    const pages = plainPages(4);
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: true, text: '', provider: 'gemini', model: 'm' }));
    let t = 0;
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision, sleep: noSleep, now: () => (t += 100_000), deadlineMs: 10_000 });
    expect(vision).not.toHaveBeenCalled();
    expect(r.method).toBe('plain_text');
  });

  it('si el modelo resume y pierde contenido, se rechaza y se cae al texto simple', async () => {
    const pages = plainPages(4, 30);
    const lazy = vi.fn(async (): Promise<PdfVisionCall> => ({
      ok: true,
      provider: 'gemini',
      model: 'm',
      text: '[[PAGINA 1]]\nResumen breve\n[[PAGINA 2]]\nResumen breve\n[[PAGINA 3]]\nResumen breve\n[[PAGINA 4]]\nResumen breve',
    }));
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision: lazy, sleep: noSleep });
    expect(r.method).toBe('plain_text');
    expect(r.report.fallback_reason).toMatch(/palabras/);
  });

  it('paginas fuera del rango pedido se descartan (alucinacion de numeracion)', async () => {
    const pages = plainPages(3);
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({
      ok: true,
      provider: 'gemini',
      model: 'm',
      text: `[[PAGINA 1]]\n${pages[0]}\n[[PAGINA 2]]\n${pages[1]}\n[[PAGINA 3]]\n${pages[2]}\n[[PAGINA 99]]\ncontenido inventado que no existe`,
    }));
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision, sleep: noSleep });
    expect(r.markdown).not.toContain('inventado');
  });

  it('una respuesta sin marcadores de pagina no se acepta', async () => {
    const pages = plainPages(3);
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: true, provider: 'gemini', model: 'm', text: pages.join('\n\n') }));
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision, sleep: noSleep });
    expect(r.method).toBe('plain_text');
  });

  it('el respaldo por texto simple avisa que se perdieron formulas', async () => {
    const pages = plainPages(3).map((p) => `${p}  `);
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: false, reason: 'no_key' }));
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => pages, vision, sleep: noSleep });
    expect(r.method).toBe('plain_text');
    expect(r.report.unreadable_symbols).toBe(9);
    expect(r.report.warnings.join(' ')).toMatch(/formulas/);
    expect(r.markdown).not.toContain('');
  });

  it('un PDF escaneado (sin texto) cuya conversion falla da un error claro, no un material vacio', async () => {
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({ ok: false, reason: 'quota', status: 429 }));
    await expect(
      convertPdfToMarkdown(bytes, { extractPlain: async () => ['', '', ''], vision, sleep: noSleep })
    ).rejects.toThrow(/escaneado/);
  });

  it('un PDF escaneado que la IA SI puede leer se convierte', async () => {
    const vision = vi.fn(async (): Promise<PdfVisionCall> => ({
      ok: true,
      provider: 'gemini',
      model: 'm',
      text: '[[PAGINA 1]]\n# Titulo\n\nContenido leido de la imagen escaneada con suficiente texto para pasar.',
    }));
    const r = await convertPdfToMarkdown(bytes, { extractPlain: async () => [''], vision, sleep: noSleep });
    expect(r.method).toBe('vision_gemini');
    expect(r.markdown).toContain('Contenido leido');
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

  it('la pagina de materiales declara maxDuration 300 (una presentacion larga tarda 1-2 minutos)', () => {
    const page = read('src/app/(teacher)/teacher/classrooms/[id]/materials/page.tsx');
    expect(Number(page.match(/export const maxDuration = (\d+)/)![1])).toBeGreaterThanOrEqual(120);
  });

  it('la migracion 048 y los tipos generados tienen las columnas de extraccion', () => {
    const sql = read('supabase/migrations/048_teaching_materials_extraction.sql');
    expect(sql).toContain('extraction_method');
    expect(sql).toContain('extraction_report');
    expect(sql).toMatch(/vision_gemini[\s\S]*vision_openrouter[\s\S]*vision_mixed[\s\S]*plain_text/);
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
});
