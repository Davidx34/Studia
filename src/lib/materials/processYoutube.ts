// Sesion K (alcance: videos de YouTube): embebe el video y, best-effort,
// intenta obtener sus subtitulos automaticos. Sesion L reemplaza el scraping
// manual de HTML (fragil: dependia de encontrar "captionTracks" en el HTML y
// de que el endpoint de timedtext no exigiera un PO token) por youtubei.js,
// un cliente mantenido de la API interna (Innertube) de YouTube que expone
// el mismo endpoint get_transcript que usa el boton "Mostrar transcripcion"
// del reproductor. Sigue siendo no oficial (no hay API publica de Google
// para esto sin ser el dueño del canal), pero es mucho mas confiable que
// parsear HTML a mano y no requiere resolver el desafio BotGuard/PO token
// (ese endpoint especifico no lo exige, a diferencia del de captions.download
// o el de timedtext directo).
//
// Si aun asi falla (ej. YouTube empieza a exigir PO token tambien aqui),
// cae a un segundo intento: Gemini soporta recibir una URL publica de
// YouTube directamente como parte del prompt (sin descargar audio ni
// depender de libs fragiles tipo ytdl-core) y "ve"/"escucha" el video para
// producir una transcripcion/resumen educativo. Solo si ambos fallan se
// marca transcript_source='none' y chunk_count=0.

import { Innertube } from 'youtubei.js';
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

// Usa youtubei.js (Innertube) solo para obtener la lista de caption_tracks
// con su base_url ya firmado por YouTube (via getBasicInfo — mas confiable
// que el endpoint get_transcript, que YouTube esta bloqueando activamente
// para requests programaticos desde hace unos dias segun reportes de la
// comunidad). Descargamos el track directamente en vez de usar el endpoint
// get_transcript porque este ultimo devuelve 400 con bastante frecuencia
// (bot detection), mientras que el base_url obtenido via Innertube si
// funciona en la mayoria de los casos probados.
async function fetchInnertubeTranscript(videoId: string): Promise<string | null> {
  try {
    const result = await Promise.race([
      (async () => {
        const yt = await Innertube.create({ generate_session_locally: true });
        const info = await yt.getBasicInfo(videoId);
        const tracks = info.captions?.caption_tracks ?? [];
        if (!tracks.length) return '';

        const track =
          tracks.find((t: any) => t.language_code === 'es' && t.kind !== 'asr') ||
          tracks.find((t: any) => t.language_code?.startsWith('es')) ||
          tracks.find((t: any) => t.language_code === 'en' && t.kind !== 'asr') ||
          tracks.find((t: any) => t.language_code?.startsWith('en')) ||
          tracks[0];

        if (!track?.base_url) return '';

        const xmlRes = await fetch(track.base_url, { cache: 'no-store' });
        if (!xmlRes.ok) return '';
        const xml = await xmlRes.text();

        const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decodeXmlEntities(m[1]));
        return lines.join(' ').replace(/\s+/g, ' ').trim();
      })(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS)),
    ]);
    return result.length > 0 ? result : null;
  } catch (err) {
    console.warn('[youtube_innertube_transcript] fallo, se intentara otro metodo:', (err as Error).message);
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

export async function processYoutubeMaterial(supabase: any, materialId: string, url: string): Promise<void> {
  try {
    const videoId = extractYoutubeId(url);
    if (!videoId) throw new Error('No se pudo reconocer el link como un video de YouTube valido.');

    const meta = await fetchOEmbed(videoId);
    let transcript = await fetchInnertubeTranscript(videoId);
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
