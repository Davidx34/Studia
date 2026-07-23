// Sesion K (alcance: videos de YouTube): embebe el video y, best-effort,
// intenta obtener sus subtitulos automaticos (sin API key, via el mismo
// mecanismo no oficial que usan varias librerias de "youtube-transcript").
// Si no hay captions, Sesion L agrega un segundo intento: Gemini soporta
// recibir una URL publica de YouTube directamente como parte del prompt
// (sin descargar audio ni depender de libs fragiles tipo ytdl-core) y
// "ve"/"escucha" el video para producir una transcripcion/resumen educativo.
// Solo si ambos fallan se marca transcript_source='none' y chunk_count=0.

import { sanitizeText, chunkEmbedAndStore } from './textProcessing';

const FETCH_TIMEOUT_MS = 15000;
const GEMINI_VIDEO_MODEL = 'gemini-2.5-flash';

export function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const embedMatch = u.pathname.match(/^\/(embed|shorts|live)\/([^/?]+)/);
      if (embedMatch) return embedMatch[2];
    }
    return null;
  } catch {
    return null;
  }
}

interface OEmbedResult {
  title: string;
  thumbnailUrl: string;
  author: string;
}

async function fetchOEmbed(videoId: string): Promise<OEmbedResult> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Video de YouTube no encontrado (HTTP ${res.status})`);
  const json = await res.json();
  return {
    title: json.title || 'Video de YouTube',
    thumbnailUrl: json.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    author: json.author_name || '',
  };
}

// Best-effort: descarga la pagina del video, extrae los captionTracks del
// JSON embebido (ytInitialPlayerResponse) y descarga el track en español o
// ingles si existe. Este mecanismo es no oficial (no hay API key para esto)
// y puede dejar de funcionar si YouTube cambia el HTML — por eso todo esta
// envuelto en try/catch y nunca bloquea el resto del flujo.
async function fetchAutoCaptions(videoId: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
    });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const match = html.match(/"captionTracks":(\[.*?\])/);
    if (!match) return null;

    const tracks = JSON.parse(match[1]) as Array<{ baseUrl: string; languageCode: string; kind?: string }>;
    if (!tracks.length) return null;

    const track =
      tracks.find((t) => t.languageCode === 'es') ||
      tracks.find((t) => t.languageCode?.startsWith('es')) ||
      tracks.find((t) => t.languageCode === 'en') ||
      tracks.find((t) => t.languageCode?.startsWith('en')) ||
      tracks[0];

    // A veces YouTube devuelve 200 con body vacio para esta URL firmada (ej.
    // si requiere un PO token que no tenemos) — se trata igual que "sin
    // captions" en vez de reventar.
    const xmlRes = await fetch(track.baseUrl, { cache: 'no-store' });
    if (!xmlRes.ok) return null;
    const xml = await xmlRes.text();

    const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decodeXmlEntities(m[1]));
    const transcript = lines.join(' ').replace(/\s+/g, ' ').trim();
    return transcript.length > 0 ? transcript : null;
  } catch (err) {
    console.warn('[youtube_captions] fallo, se sirve el video sin transcripcion:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Best-effort: le pide a Gemini que "vea" el video (via fileData.fileUri
// apuntando a la URL publica de YouTube, soportado por los modelos 2.x) y
// devuelva una transcripcion/resumen educativo detallado, con suficiente
// contenido para alimentar generacion de preguntas por RAG. Solo funciona
// con videos publicos (no privados/no listados con restricciones) y puede
// fallar por duracion excesiva o restricciones regionales — todo envuelto
// en try/catch, nunca bloquea el resto del flujo.
async function fetchGeminiVideoTranscript(videoId: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Este es un video educativo de YouTube. Genera una transcripcion/resumen detallado y fiel de TODO su contenido, en espanol, pensado para servir de material de estudio universitario. Incluye las ideas, definiciones, ejemplos, formulas y datos concretos que se mencionen, en el orden en que aparecen. No agregues opiniones ni contenido que no este en el video. Devuelve solo el texto, sin encabezados ni markdown.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VIDEO_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4000,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!res.ok) {
      console.warn('[youtube_gemini_video] fallo HTTP', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || typeof text !== 'string') return null;
    const cleaned = text.trim();
    return cleaned.length > 0 ? cleaned : null;
  } catch (err) {
    console.warn('[youtube_gemini_video] fallo, se sirve el video sin transcripcion:', (err as Error).message);
    return null;
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '');
}

export async function processYoutubeMaterial(supabase: any, materialId: string, url: string): Promise<void> {
  try {
    const videoId = extractYoutubeId(url);
    if (!videoId) throw new Error('No se pudo reconocer el link como un video de YouTube valido.');

    const meta = await fetchOEmbed(videoId);
    let transcript = await fetchAutoCaptions(videoId);
    let transcriptSource: 'youtube_captions' | 'gemini_video' = 'youtube_captions';

    if (!transcript) {
      transcript = await fetchGeminiVideoTranscript(videoId);
      transcriptSource = 'gemini_video';
    }

    const baseUpdate = {
      display_name: meta.title,
      external_title: meta.title,
      external_url: url,
      youtube_video_id: videoId,
      thumbnail_url: meta.thumbnailUrl,
      processing_status: 'completed' as const,
      processing_error: null,
      processed_at: new Date().toISOString(),
    };

    if (!transcript) {
      await supabase
        .from('teaching_materials')
        .update({ ...baseUpdate, transcript_source: 'none', chunk_count: 0 })
        .eq('id', materialId);
      return;
    }

    const sanitized = sanitizeText(transcript);
    const { chunkCount, topics, difficulty } = await chunkEmbedAndStore(supabase, materialId, sanitized);

    await supabase
      .from('teaching_materials')
      .update({
        ...baseUpdate,
        transcript_source: transcriptSource,
        extracted_text: sanitized,
        extracted_text_preview: sanitized.slice(0, 500),
        chunk_count: chunkCount,
        topics_detected: topics,
        estimated_difficulty: difficulty,
      })
      .eq('id', materialId);
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido procesando el video';
    await supabase
      .from('teaching_materials')
      .update({ processing_status: 'failed', processing_error: message })
      .eq('id', materialId);
  }
}
