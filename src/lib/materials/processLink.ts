// Sesion K (alcance: links externos): scrapea un URL, extrae el contenido
// principal con linkedom (parser DOM liviano, sin dependencias nativas) y lo
// procesa exactamente igual que un documento subido (chunks + embeddings +
// deteccion de temas), reusando textProcessing.ts.

import { parseHTML } from 'linkedom';
import { sanitizeText, chunkEmbedAndStore } from './textProcessing';

const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5MB, evita descargar paginas gigantes

export interface ScrapedLink {
  title: string;
  favicon: string;
  text: string;
}

export async function scrapeLink(url: string): Promise<ScrapedLink> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StudiaBot/1.0)' },
    });
    if (!res.ok) throw new Error(`No se pudo descargar el link (HTTP ${res.status})`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`El link no apunta a una pagina HTML (${contentType || 'tipo desconocido'})`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) throw new Error('La pagina es demasiado grande para procesar.');
    html = new TextDecoder('utf-8').decode(buf);
  } finally {
    clearTimeout(timeout);
  }

  const { document } = parseHTML(html);

  // Quitar elementos que no son contenido (nav, scripts, ads, etc).
  document.querySelectorAll('script, style, nav, header, footer, aside, noscript, iframe, svg').forEach((el: any) => el.remove());

  const title =
    document.querySelector('h1')?.textContent?.trim() ||
    document.querySelector('title')?.textContent?.trim() ||
    url;

  const faviconHref =
    document.querySelector('link[rel="icon"]')?.getAttribute('href') ||
    document.querySelector('link[rel="shortcut icon"]')?.getAttribute('href') ||
    '/favicon.ico';
  const favicon = new URL(faviconHref, url).toString();

  const mainEl =
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body;

  const text = sanitizeText((mainEl?.textContent || '').replace(/\s+/g, ' '));

  return { title: title.slice(0, 200), favicon, text };
}

export async function processLinkMaterial(supabase: any, materialId: string, url: string): Promise<void> {
  try {
    const scraped = await scrapeLink(url);
    if (scraped.text.length < 50) {
      throw new Error('El contenido extraido es muy corto. ¿La pagina requiere JavaScript para mostrar el texto?');
    }

    const { chunkCount, topics, difficulty } = await chunkEmbedAndStore(supabase, materialId, scraped.text);

    await supabase
      .from('teaching_materials')
      .update({
        display_name: scraped.title,
        external_title: scraped.title,
        external_favicon: scraped.favicon,
        extracted_text: scraped.text,
        extracted_text_preview: scraped.text.slice(0, 500),
        chunk_count: chunkCount,
        topics_detected: topics,
        estimated_difficulty: difficulty,
        processing_status: 'completed',
        processing_error: null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', materialId);
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido procesando el link';
    await supabase
      .from('teaching_materials')
      .update({ processing_status: 'failed', processing_error: message })
      .eq('id', materialId);
  }
}
