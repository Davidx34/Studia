// Sesion K (alcance: videos de YouTube): embebe el video y extrae sus
// subtitulos (manuales o automaticos) via youtubei.js, un cliente mantenido
// de la API interna (Innertube) de YouTube que expone el mismo endpoint
// get_transcript que usa el boton "Mostrar transcripcion" del reproductor.
// Sigue siendo no oficial (no hay API publica de Google para esto sin ser
// el dueño del canal), pero es mucho mas confiable que parsear HTML a mano
// y no requiere resolver el desafio BotGuard/PO token (ese endpoint
// especifico no lo exige, a diferencia del de captions.download o el de
// timedtext directo).
//
// Decision de producto: solo se procesan videos que YA tienen subtitulos
// reales en YouTube. No hay fallback a un LLM "viendo" el video (eso tiene
// costo/cuota variable y deja de ser 100% gratuito y predecible) — si el
// video no tiene subtitulos, se marca honestamente transcript_source='none'
// en vez de fabricar una transcripcion aproximada.

import { Innertube } from 'youtubei.js';
import { sanitizeText, chunkEmbedAndStore } from './textProcessing';
import type { TypedSupabaseClient } from '@/lib/supabase/types';

const FETCH_TIMEOUT_MS = 15000;

// Cuando el profesor agrega varios videos seguidos, YouTube a veces
// bloquea/limita peticiones consecutivas por un momento (rate limiting
// transitorio) — un video real, con captions reales, puede fallar sin
// motivo aparente solo por mala suerte de timing. NoRetryError distingue
// eso de una ausencia real (el video simplemente no tiene captions), que no
// tiene sentido reintentar.
class NoRetryError extends Error {}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// Reintenta con backoff exponencial + jitter. Para en seco (sin reintentar)
// si el intento lanza NoRetryError, ya que eso indica una condicion
// permanente (ej. el video no tiene subtitulos) y no una falla transitoria.
async function withRetry<T>(fn: () => Promise<T>, retries: number, baseDelayMs: number, label: string): Promise<T | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NoRetryError) return null;
      lastErr = err;
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250);
        console.warn(`[${label}] intento ${attempt + 1}/${retries + 1} fallo (${(err as Error).message}), reintentando en ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  console.warn(`[${label}] fallo definitivo tras ${retries + 1} intentos:`, (lastErr as Error)?.message ?? lastErr);
  return null;
}

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
  return withRetry(
    () =>
      withTimeout(
        (async () => {
          const yt = await Innertube.create({ generate_session_locally: true });
          const info = await yt.getBasicInfo(videoId);
          const tracks = info.captions?.caption_tracks ?? [];
          if (!tracks.length) throw new NoRetryError('el video no tiene caption_tracks');

          const track =
            tracks.find((t: any) => t.language_code === 'es' && t.kind !== 'asr') ||
            tracks.find((t: any) => t.language_code?.startsWith('es')) ||
            tracks.find((t: any) => t.language_code === 'en' && t.kind !== 'asr') ||
            tracks.find((t: any) => t.language_code?.startsWith('en')) ||
            tracks[0];
          if (!track?.base_url) throw new NoRetryError('caption_track sin base_url');

          const xmlRes = await fetch(track.base_url, { cache: 'no-store' });
          if (!xmlRes.ok) throw new Error(`timedtext respondio HTTP ${xmlRes.status}`);
          const xml = await xmlRes.text();

          const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decodeXmlEntities(m[1]));
          const text = lines.join(' ').replace(/\s+/g, ' ').trim();
          // Cuerpo vacio con HTTP 200 es la firma tipica de un bloqueo
          // transitorio de YouTube (rate limiting) — lo tratamos como
          // reintentable, no como "sin captions".
          if (!text) throw new Error('timedtext devolvio contenido vacio (posible bloqueo transitorio)');
          return text;
        })(),
        FETCH_TIMEOUT_MS
      ),
    4,
    1000,
    'youtube_innertube_transcript'
  );
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

export async function processYoutubeMaterial(supabase: TypedSupabaseClient, materialId: string, url: string): Promise<void> {
  try {
    const videoId = extractYoutubeId(url);
    if (!videoId) throw new Error('No se pudo reconocer el link como un video de YouTube valido.');

    const meta = await fetchOEmbed(videoId);
    const transcript = await fetchInnertubeTranscript(videoId);
    const transcriptSource: 'youtube_captions' = 'youtube_captions';

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
      // No se pudo obtener transcripcion en este intento (tras los
      // reintentos). Si ya habia contenido bueno de un procesamiento
      // anterior — por ejemplo, un "Reintentar" que volvio a chocar con un
      // bloqueo transitorio de YouTube — lo dejamos intacto en vez de
      // borrarlo: es mejor conservar datos buenos viejos que perderlos por
      // una falla momentanea nueva.
      const { data: existing } = await supabase
        .from('teaching_materials')
        .select('chunk_count, auto_retry_count')
        .eq('id', materialId)
        .single();

      // auto_retry_count: cuantas veces seguidas fallo el procesamiento de
      // este material. El cron de reintento en segundo plano
      // (/api/cron/retry-youtube-materials) usa este contador para dejar de
      // reintentar automaticamente pasado un limite, en vez de insistir para
      // siempre con un video que genuinamente no tiene captions.
      const nextRetryCount = (existing?.auto_retry_count ?? 0) + 1;

      if ((existing?.chunk_count ?? 0) > 0) {
        await supabase
          .from('teaching_materials')
          .update({ ...baseUpdate, auto_retry_count: nextRetryCount })
          .eq('id', materialId);
      } else {
        await supabase
          .from('teaching_materials')
          .update({ ...baseUpdate, transcript_source: 'none', chunk_count: 0, auto_retry_count: nextRetryCount })
          .eq('id', materialId);
      }
      return;
    }

    const sanitized = sanitizeText(transcript);
    // chunkEmbedAndStore borra los chunks viejos solo despues de calcular
    // los embeddings nuevos con exito, para que un fallo transitorio en el
    // paso de embedding nunca destruya datos buenos existentes.
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
        auto_retry_count: 0,
      })
      .eq('id', materialId);
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido procesando el video';
    // Incrementamos auto_retry_count tambien aqui (no solo en la rama de
    // "sin transcripcion") para que el cron de reintento en segundo plano
    // (que ahora tambien recoge processing_status='failed', ver
    // /api/cron/retry-youtube-materials) respete el mismo tope de
    // MAX_AUTO_RETRIES y no reintente para siempre un fallo permanente
    // (ej. GEMINI_API_KEY invalida).
    const { data: existing } = await supabase
      .from('teaching_materials')
      .select('auto_retry_count')
      .eq('id', materialId)
      .single();
    await supabase
      .from('teaching_materials')
      .update({
        processing_status: 'failed',
        processing_error: message,
        auto_retry_count: (existing?.auto_retry_count ?? 0) + 1,
      })
      .eq('id', materialId);
  }
}
