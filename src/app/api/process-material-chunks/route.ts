import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

// Sesion I, Fix 3: la Biblioteca de Clase mostraba el chunk crudo del
// material (pared de texto larga) — este endpoint lo resume con Gemini en
// summary + key_points + main_concepts, una sola vez por chunk (se cachea
// en material_chunks_processed). Se llama "lazy": la primera vez que un
// estudiante abre un material sin procesar, LibraryClient dispara esta
// ruta, que procesa TODOS los chunks pendientes de ese material de una vez.

const CONCURRENCY = 4;

async function processChunkWithGemini(content: string): Promise<{ summary: string; key_points: string[]; main_concepts: string[] } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Procesa el siguiente contenido educativo para estudiantes de secundaria y devuelve SOLO un JSON valido (sin markdown, sin explicacion) con:
- summary: resumen de 2-3 lineas (maximo 100 palabras)
- key_points: array de 3-5 puntos clave, cada uno una oracion corta
- main_concepts: array de 3-5 conceptos principales (palabras o frases cortas)

Contenido:
${content.slice(0, 3000)}

Responde con este formato exacto:
{"summary":"...","key_points":["...","..."],"main_concepts":["...","..."]}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 700,
            responseMimeType: 'application/json',
            // Mismo fix que tonito-chat (Sesion I, Fix 2): sin esto, el
            // "thinking" interno del modelo se come el token budget y la
            // respuesta llega truncada / sin cerrar el JSON.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (!parsed.summary || !Array.isArray(parsed.key_points) || !Array.isArray(parsed.main_concepts)) return null;
    return { summary: parsed.summary, key_points: parsed.key_points, main_concepts: parsed.main_concepts };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { materialId } = await req.json();
    if (!materialId) return NextResponse.json({ error: 'materialId requerido' }, { status: 400 });

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    // RLS ya filtra: solo devuelve chunks si el usuario puede leer este material
    // (estudiante inscrito o profesor dueño) — mismo criterio que la Biblioteca.
    const { data: chunks } = await supabase
      .from('material_chunks')
      .select('id, content')
      .eq('material_id', materialId)
      .order('chunk_index');

    if (!chunks || chunks.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    const { data: already } = await supabase
      .from('material_chunks_processed')
      .select('chunk_id')
      .eq('material_id', materialId);
    const doneIds = new Set((already || []).map((r: any) => r.chunk_id));
    const pending = chunks.filter((c: any) => !doneIds.has(c.id));

    let processedCount = 0;
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (chunk: any) => {
          const processed = await processChunkWithGemini(chunk.content);
          return processed ? { chunk_id: chunk.id, material_id: materialId, ...processed } : null;
        })
      );
      const rows = results.filter((r) => r !== null);
      if (rows.length > 0) {
        await supabase.from('material_chunks_processed').upsert(rows, { onConflict: 'chunk_id' });
        processedCount += rows.length;
      }
    }

    return NextResponse.json({ processed: processedCount, total: chunks.length });
  } catch (e) {
    console.error('[process-material-chunks] error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
